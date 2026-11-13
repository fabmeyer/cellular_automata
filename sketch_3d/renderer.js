class GridRenderer {
    constructor(settings, drawing = globalThis, random = Math.random) {
        this.settings = settings;
        this.drawing = drawing;
        const isCA = settings.simulation.algorithm === "CA";
        this.colors = [isCA ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.05)"];
        for (let state = 1; state < settings.simulation.states; state++) {
            const rgb = Array.from({ length: 3 }, () => Math.floor(random() * 255));
            this.colors.push(isCA ? `rgb(${rgb.join(", ")})` : `rgba(${rgb.join(", ")}, 0.95)`);
        }
    }

    setup() {
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
        p.createCanvas(canvasWidth, canvasHeight, p.WEBGL);
        p.camera(0, 0, cameraDistance, 0, 0, 0, 0, 1, 0);
        p.ortho(-halfWidth, halfWidth, halfHeight, -halfHeight, -8 * cameraDistance, 8 * cameraDistance);
        p.background(view.background);
        p.noLoop();
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
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                const cell = grid[x][y][zIndex];
                p.push();
                p.fill(this.colors[cell.state]);
                p.translate(cell.x - cols * cellSize / 2 + cellSize / 2,
                    cell.y - rows * cellSize / 2 + cellSize / 2,
                    (cell.z + 0.5) * cellSize - this.settings.depth * cellSize / 2);
                p.box(cellSize, cellSize, cellSize);
                p.pop();
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
    }
}
