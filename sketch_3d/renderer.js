class GridRenderer {
    constructor(settings, drawing = globalThis, random = Math.random) {
        this.settings = settings;
        this.drawing = drawing;
        const isCA = settings.simulation.algorithm === "CA";
        const state0Alpha = settings.coloring.state0Alpha ?? (isCA ? 0.5 : 0.05);
        const otherStatesAlpha = settings.coloring.otherStatesAlpha ?? (isCA ? 1 : 0.95);
        this.coloring = { state0Alpha, otherStatesAlpha };
        this.shading = settings.coloring.shading ?? 0;
        this.alphas = [state0Alpha];
        this.colors = [`rgba(0, 0, 0, ${state0Alpha})`];
        for (let state = 1; state < settings.simulation.states; state++) {
            const rgb = Array.from({ length: 3 }, () => Math.floor(random() * 255));
            this.alphas.push(otherStatesAlpha);
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
        const sparse = this.settings.simulation.algorithm === "PN" && this.settings.pn.movementUnit !== null;
        const capacity = cols * rows * 2;
        const textureLimit = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
        const dataWidth = sparse ? Math.min(textureLimit, Math.ceil(Math.sqrt(capacity * 5))) : rows;
        const dataHeight = sparse ? Math.ceil(capacity * 5 / dataWidth) : cols;
        if (dataWidth > textureLimit || dataHeight > textureLimit) {
            throw this.allocationError(`PN position texture ${dataWidth}x${dataHeight} exceeds texture limit ${textureLimit}`);
        }
        const states = p.createImage(dataWidth, dataHeight);
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
            in vec3 aNormal;
            uniform mat4 uModelViewMatrix;
            uniform mat3 uNormalMatrix;
            uniform mat4 uProjectionMatrix;
            uniform sampler2D states;
            uniform int rows;
            uniform vec2 gridSize;
            uniform float cellSize;
            uniform float layerZ;
            uniform vec4 palette[9];
            uniform float shading;
            uniform int pass;
            const vec3 lightDirection = normalize(vec3(0.35, -0.8, 0.5));
            flat out vec4 cellColor;
            ${sparse ? `
            uniform int dataWidth;
            vec4 dataTexel(int index) {
                return texelFetch(states, ivec2(index % dataWidth, index / dataWidth), 0);
            }
            float positionValue(int index) {
                uvec3 low = uvec3(round(dataTexel(index).rgb * 255.0));
                uint high = uint(round(dataTexel(index + 1).r * 255.0));
                return uintBitsToFloat(low.r | (low.g << 8) | (low.b << 16) | (high << 24));
            }` : ""}
            void main() {
                ${sparse ? `
                int base = gl_InstanceID * 5;
                int state = int(round(dataTexel(base + 4).r * 255.0));
                vec3 offset = vec3(positionValue(base), positionValue(base + 2), layerZ);
                ` : `
                int x = gl_InstanceID / rows;
                int y = gl_InstanceID - x * rows;
                int state = int(round(texelFetch(states, ivec2(y, x), 0).r * 255.0));
                vec3 offset = vec3((vec2(x, y) - gridSize / 2.0 + 0.5) * cellSize, layerZ);
                `}
                cellColor = palette[state];
                // Pass 0 draws mostly opaque cells, pass 1 faint ones; skipped instances collapse off-screen.
                if (cellColor.a == 0.0 || (pass == 0) != (cellColor.a >= ${GridRenderer.solidAlpha.toFixed(2)})) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    return;
                }
                float diffuse = max(dot(normalize(uNormalMatrix * aNormal), lightDirection), 0.0);
                cellColor.rgb *= mix(1.0, 0.35 + 0.65 * diffuse, shading);
                gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition + offset, 1.0);
            }`, `#version 300 es
            precision highp float;
            flat in vec4 cellColor;
            out vec4 outColor;
            void main() { outColor = vec4(cellColor.rgb * cellColor.a, cellColor.a); }`);
        const cube = p.buildGeometry(() => p.box(cellSize, cellSize, cellSize));
        return { states, palette, shader, cube, sparse, dataWidth, capacity };
    }

    *positionCells(grid, zIndex) {
        const { cols, rows, cellSize } = this.settings.grid;
        const scale = grid.positionScale;
        const occupied = grid.layer(zIndex);
        const mask = new Uint8Array(cols * rows);
        for (const cell of occupied.values()) {
            const x = Math.floor(cell.x / scale + 0.5);
            const y = Math.floor(cell.y / scale + 0.5);
            if (x >= 0 && x < cols && y >= 0 && y < rows) {
                mask[x * rows + y] = 1;
            }
        }
        for (let x = 0; x < cols && this.alphas[0] > 0; x++) {
            for (let y = 0; y < rows; y++) {
                if (mask[x * rows + y] === 0) {
                    yield { x: (x + 0.5 - cols / 2) * cellSize,
                        y: (y + 0.5 - rows / 2) * cellSize, state: 0 };
                }
            }
        }
        const unit = this.settings.pn.movementUnit;
        for (const cell of occupied.values()) {
            const x = cell.x * unit + (0.5 - cols / 2) * cellSize;
            const y = cell.y * unit + (0.5 - rows / 2) * cellSize;
            if (!Number.isFinite(Math.fround(x)) || !Number.isFinite(Math.fround(y))) {
                throw new Error(`PN rendered position exceeds float32 range at layer ${zIndex}`);
            }
            if (this.alphas[cell.state] > 0) {
                yield { x, y, state: cell.state };
            }
        }
    }

    uploadPositions(grid, zIndex) {
        const { states, capacity } = this.instancing;
        const bytes = new Uint8Array(4);
        const view = new DataView(bytes.buffer);
        let count = 0;
        // Keep texture alpha opaque: canvas premultiplication would corrupt packed position bytes.
        for (const cell of this.positionCells(grid, zIndex)) {
            if (count >= capacity) {
                throw new Error(`PN position count exceeds renderer capacity at layer ${zIndex}`);
            }
            const base = count * 20;
            for (const [axis, value] of [cell.x, cell.y].entries()) {
                view.setFloat32(0, value, true);
                const offset = base + axis * 8;
                states.pixels[offset] = bytes[0];
                states.pixels[offset + 1] = bytes[1];
                states.pixels[offset + 2] = bytes[2];
                states.pixels[offset + 4] = bytes[3];
            }
            states.pixels[base + 16] = cell.state;
            count++;
        }
        states.updatePixels();
        return count;
    }

    // Cells at or above this alpha write depth; fainter cells only tint and never hide cubes drawn later behind them.
    static solidAlpha = 0.5;

    drawInstances(shader, cube, count) {
        const p = this.drawing;
        shader.setUniform("pass", 0);
        p.model(cube, count);
        if (this.alphas.some(alpha => alpha > 0 && alpha < GridRenderer.solidAlpha)) {
            shader.setUniform("pass", 1);
            this.gl.depthMask(false);
            try {
                p.model(cube, count);
            } finally {
                this.gl.depthMask(true);
            }
        }
    }

    // Used by the box() fallback; the instanced shader applies the same light itself.
    applyLights() {
        const p = this.drawing;
        if (this.shading > 0 && typeof p.directionalLight === "function") {
            const directional = 255 * 0.65 * this.shading;
            p.ambientLight(255 - directional);
            p.directionalLight(directional, directional, directional, -0.35, 0.8, -0.5);
        } else {
            p.ambientLight(255);
        }
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
        this.applyLights();
        p.push();
        const [rx, ry, rz] = this.settings.preset.rotation;
        p.rotateX(Math.PI * rx);
        p.rotateY(Math.PI * ry);
        p.rotateZ(Math.PI * rz);
        const layer = grid.layer(zIndex);
        if (grid.positionsInitialized) {
            const layerZ = (zIndex + 0.5) * cellSize - this.settings.depth * cellSize / 2;
            if (this.instancing) {
                const count = this.uploadPositions(grid, zIndex);
                const { states, palette, shader, cube, dataWidth } = this.instancing;
                this.assertContext();
                try {
                    p.shader(shader);
                    shader.setUniform("states", states);
                    shader.setUniform("dataWidth", dataWidth);
                    shader.setUniform("layerZ", layerZ);
                    shader.setUniform("palette", palette);
                    shader.setUniform("shading", this.shading);
                    if (count > 0) {
                        this.drawInstances(shader, cube, count);
                    }
                    p.resetShader();
                } catch (error) {
                    this.assertContext();
                    throw error;
                }
            } else {
                for (const cell of this.positionCells(grid, zIndex)) {
                    p.push();
                    p.fill(this.colors[cell.state]);
                    p.translate(cell.x, cell.y, layerZ);
                    p.box(cellSize, cellSize, cellSize);
                    p.pop();
                }
            }
            p.pop();
            this.assertContext();
            return;
        }
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
                shader.setUniform("shading", this.shading);
                this.drawInstances(shader, cube, cols * rows);
                p.resetShader();
            } catch (error) {
                this.assertContext();
                throw error;
            }
        } else {
            for (let x = 0; x < cols; x++) {
                for (let y = 0; y < rows; y++) {
                    if (this.alphas[layer[x * rows + y]] === 0) {
                        continue;
                    }
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
            if (this.alphas[cell.state] === 0) {
                continue;
            }
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
