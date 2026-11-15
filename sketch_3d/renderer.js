class GridRenderer {
    constructor(settings, drawing = globalThis, random = Math.random) {
        this.settings = settings;
        this.drawing = drawing;
        const isCA = settings.simulation.algorithm === "CA";
        const state0Alpha = settings.coloring.state0Alpha ?? (isCA ? 0.5 : 0.05);
        const otherStatesAlpha = settings.coloring.otherStatesAlpha ?? (isCA ? 1 : 0.95);
        this.coloring = { state0Alpha, otherStatesAlpha };
        this.colors = [`rgba(0, 0, 0, ${state0Alpha})`];
        for (let state = 1; state < settings.simulation.states; state++) {
            const rgb = Array.from({ length: 3 }, () => Math.floor(random() * 255));
            this.colors.push(otherStatesAlpha === 1
                ? `rgb(${rgb.join(", ")})`
                : `rgba(${rgb.join(", ")}, ${otherStatesAlpha})`);
        }
    }

    setup(onContextLost) {
        const p = this.drawing;
        const { grid, depth, canvasWidth, canvasHeight, view } = this.settings;
        // Fit the screen-space outline of the rotated block tightly to the canvas aspect ratio.
        const { halfX, halfY } = GridRenderer.projectedHalfExtents(
            [grid.cols * grid.cellSize / 2, grid.rows * grid.cellSize / 2, depth * grid.cellSize / 2],
            this.settings.preset.rotation);
        const aspect = canvasWidth / canvasHeight;
        const halfHeight = Math.max(halfY, halfX / aspect) * view.cameraPadding / view.zoom;
        const halfWidth = halfHeight * aspect;
        if (![halfWidth, halfHeight, 1 / halfWidth, 1 / halfHeight]
            .every(value => Number.isFinite(Math.fround(value)) && Math.fround(value) > 0)) {
            throw new Error("view.zoom must produce usable finite float32 camera bounds");
        }
        const radius = Math.hypot(grid.cols, grid.rows, depth) * grid.cellSize / 2;
        const cameraDistance = radius + grid.cellSize;
        // p5 2 requires a WebGL renderer before setAttributes; any context reset stays tiny.
        p.createCanvas(1, 1, p.WEBGL);
        p.setAttributes("antialias", view.antialias);
        p.pixelDensity(1);
        this.gl = p.drawingContext;
        this.assertContext();
        let gl = this.gl;
        const textureLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const bufferLimit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
        const viewportLimit = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        const maxWidth = Math.min(textureLimit, bufferLimit, viewportLimit[0]);
        const maxHeight = Math.min(textureLimit, bufferLimit, viewportLimit[1]);
        if (canvasWidth > maxWidth || canvasHeight > maxHeight) {
            throw this.allocationError(`requested dimensions exceed hardware limits ${maxWidth}x${maxHeight} ` +
                `(texture=${textureLimit}, renderbuffer=${bufferLimit}, viewport=${viewportLimit[0]}x${viewportLimit[1]})`);
        }
        try {
            // Set the bitmap size before getContext: resizing an existing context can impose an area cap.
            const canvas = gl.canvas.ownerDocument.createElement("canvas");
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            p.createCanvas(canvasWidth, canvasHeight, p.WEBGL, canvas);
        } catch (error) {
            throw new Error(this.allocationError("canvas allocation failed").message, { cause: error });
        }
        this.gl = gl = p.drawingContext;
        gl.canvas.addEventListener("webglcontextlost", () => {
            this.contextError ??= this.allocationError("context lost");
            if (onContextLost) {
                onContextLost(this.contextError);
            } else {
                console.error(this.contextError);
            }
        });
        this.assertContext();
        const allocationError = gl.getError();
        if (allocationError !== gl.NO_ERROR) {
            throw this.allocationError(`canvas allocation failed (WebGL error ${allocationError})`);
        }
        if (gl.canvas.width !== canvasWidth || gl.canvas.height !== canvasHeight ||
            gl.drawingBufferWidth !== canvasWidth || gl.drawingBufferHeight !== canvasHeight) {
            throw this.allocationError(`drawing buffer allocation returned ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`);
        }
        p.camera(0, 0, cameraDistance, 0, 0, 0, 0, 1, 0);
        p.ortho(-halfWidth, halfWidth, halfHeight, -halfHeight, -8 * cameraDistance, 8 * cameraDistance);
        p.background(view.background);
        this.assertContext();
        p.noLoop();
        this.instancing = this.createInstancing();
        this.assertContext();
    }

    allocationError(reason) {
        const { canvasWidth, canvasHeight, view } = this.settings;
        return new Error(`WebGL ${reason} for requested canvas ${canvasWidth}x${canvasHeight} ` +
            `(pixel density 1, antialias=${view.antialias}). Reduce view canvasScale or explicitly ` +
            "set view.antialias=false; reported hardware limits do not guarantee sufficient GPU memory.");
    }

    assertContext() {
        if (this.contextError) {
            throw this.contextError;
        }
        if (this.gl?.isContextLost()) {
            this.contextError = this.allocationError("context lost");
            throw this.contextError;
        }
    }

    // Draws a whole layer with one instanced call; returns null when the context cannot (e.g. test stubs, WebGL1).
    createInstancing() {
        const p = this.drawing;
        if (![p.createShader, p.buildGeometry, p.model, p.createImage].every(fn => typeof fn === "function") ||
            p.webglVersion !== p.WEBGL2) {
            return null;
        }
        const { cols, rows, cellSize } = this.settings.grid;
        const states = p.createImage(rows, cols);
        states.loadPixels();
        for (let i = 3; i < states.pixels.length; i += 4) {
            states.pixels[i] = 255;
        }
        const palette = this.colors.flatMap(color => {
            const [r, g, b, a = 1] = color.match(/[\d.]+/g).map(Number);
            return [r / 255, g / 255, b / 255, a];
        });
        while (palette.length < 36) {
            palette.push(0);
        }
        const shader = p.createShader(`#version 300 es
            precision highp float;
            precision highp int;
            in vec3 aPosition;
            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            uniform sampler2D states;
            uniform int rows;
            uniform vec2 gridSize;
            uniform float cellSize;
            uniform float layerZ;
            uniform vec4 palette[9];
            flat out vec4 cellColor;
            void main() {
                int x = gl_InstanceID / rows;
                int y = gl_InstanceID - x * rows;
                int state = int(round(texelFetch(states, ivec2(y, x), 0).r * 255.0));
                cellColor = palette[state];
                vec3 offset = vec3((vec2(x, y) - gridSize / 2.0 + 0.5) * cellSize, layerZ);
                gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition + offset, 1.0);
            }`, `#version 300 es
            precision highp float;
            flat in vec4 cellColor;
            out vec4 outColor;
            void main() { outColor = vec4(cellColor.rgb * cellColor.a, cellColor.a); }`);
        const cube = p.buildGeometry(() => p.box(cellSize, cellSize, cellSize));
        return { states, palette, shader, cube };
    }

    // Mirrors drawLayer: rotateX, rotateY, rotateZ applied to the model, so vertices see Rx(Ry(Rz(v))).
    static projectedHalfExtents(halfSize, rotation) {
        const [ax, ay, az] = rotation.map(turn => Math.PI * turn);
        let halfX = 0;
        let halfY = 0;
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    let [x, y, z] = [sx * halfSize[0], sy * halfSize[1], sz * halfSize[2]];
                    [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
                    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
                    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
                    halfX = Math.max(halfX, Math.abs(x));
                    halfY = Math.max(halfY, Math.abs(y));
                }
            }
        }
        return { halfX, halfY };
    }

    drawLayer(grid, zIndex) {
        this.assertContext();
        const p = this.drawing;
        const { cols, rows, cellSize } = this.settings.grid;
        p.noStroke();
        p.noLights();
        p.ambientLight(255);
        p.push();
        const [rx, ry, rz] = this.settings.preset.rotation;
        p.rotateX(Math.PI * rx);
        p.rotateY(Math.PI * ry);
        p.rotateZ(Math.PI * rz);
        const layer = grid.layer(zIndex);
        if (this.instancing) {
            const { states, palette, shader, cube } = this.instancing;
            for (let i = 0; i < layer.length; i++) {
                states.pixels[i * 4] = layer[i];
            }
            states.updatePixels();
            this.assertContext();
            try {
                p.shader(shader);
                shader.setUniform("states", states);
                shader.setUniform("rows", rows);
                shader.setUniform("gridSize", [cols, rows]);
                shader.setUniform("cellSize", cellSize);
                shader.setUniform("layerZ", (zIndex + 0.5) * cellSize - this.settings.depth * cellSize / 2);
                shader.setUniform("palette", palette);
                p.model(cube, cols * rows);
                p.resetShader();
            } catch (error) {
                this.assertContext();
                throw error;
            }
        } else {
            for (let x = 0; x < cols; x++) {
                for (let y = 0; y < rows; y++) {
                    p.push();
                    p.fill(this.colors[layer[x * rows + y]]);
                    p.translate(x * cellSize - cols * cellSize / 2 + cellSize / 2,
                        y * cellSize - rows * cellSize / 2 + cellSize / 2,
                        (zIndex + 0.5) * cellSize - this.settings.depth * cellSize / 2);
                    p.box(cellSize, cellSize, cellSize);
                    p.pop();
                }
            }
        }
        for (const cell of grid.outsideLayers?.[zIndex]?.values() ?? []) {
            p.push();
            p.fill(this.colors[cell.state]);
            p.translate(cell.x * cellSize - cols * cellSize / 2 + cellSize / 2,
                cell.y * cellSize - rows * cellSize / 2 + cellSize / 2,
                (zIndex + 0.5) * cellSize - this.settings.depth * cellSize / 2);
            p.box(cellSize, cellSize, cellSize);
            p.pop();
        }
        p.pop();
        this.assertContext();
    }
}
