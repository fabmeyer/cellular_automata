// Default layers use one byte per cell; PN position layers use sparse integer-tick anchors.
// Layers are separate allocations, avoiding a single multi-GiB volume buffer.
class StateGrid {
    constructor(cols, rows, depth, retainHistory = true, positionScale = null) {
        this.cols = cols;
        this.rows = rows;
        this.depth = depth;
        this.retainHistory = retainHistory;
        this.positionScale = positionScale;
        this.positionsInitialized = false;
        this.layers = Array.from({ length: depth }, () =>
            retainHistory && positionScale === null ? new Uint8Array(cols * rows) : null);
        this.releasedThrough = -1;
    }

    reset() {
        this.positionsInitialized = false;
        this.layers = Array.from({ length: this.depth }, () =>
            this.retainHistory && this.positionScale === null ? new Uint8Array(this.cols * this.rows) : null);
        this.releasedThrough = -1;
    }

    // Dense layers are x-major (x * rows + y); position layers are coordinate-keyed maps.
    layer(z) {
        if (!Number.isInteger(z) || z < 0 || z >= this.depth) {
            throw new RangeError(`Layer index out of bounds: ${z}`);
        }
        if (z <= this.releasedThrough) {
            throw new Error(`Layer ${z} has already been released`);
        }
        if (this.layers[z] === null) {
            this.layers[z] = this.positionsInitialized ? new Map() : new Uint8Array(this.cols * this.rows);
        }
        return this.layers[z];
    }

    get(x, y, z) {
        if (this.positionsInitialized) {
            return this.layer(z).get(`${x},${y}`)?.state ?? 0;
        }
        return this.layer(z)[x * this.rows + y];
    }

    set(x, y, z, state) {
        if (this.positionsInitialized) {
            if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
                throw new Error("PN position coordinates must be safe integers");
            }
            if (state === 0) {
                this.layer(z).delete(`${x},${y}`);
            } else {
                this.layer(z).set(`${x},${y}`, { x, y, state });
            }
            return;
        }
        this.layer(z)[x * this.rows + y] = state;
    }

    initializePositions() {
        if (this.positionsInitialized || this.positionScale === null) {
            return;
        }
        const initial = this.layer(0);
        const positions = new Map();
        for (let x = 0; x < this.cols; x++) {
            for (let y = 0; y < this.rows; y++) {
                const state = initial[x * this.rows + y];
                if (state !== 0) {
                    const px = x * this.positionScale;
                    const py = y * this.positionScale;
                    positions.set(`${px},${py}`, { x: px, y: py, state });
                }
            }
        }
        this.layers[0] = positions;
        this.positionsInitialized = true;
    }

    releaseLayer(z) {
        if (!Number.isInteger(z) || z < 0 || z >= this.depth) {
            throw new RangeError(`Layer index out of bounds: ${z}`);
        }
        if (this.retainHistory) {
            return;
        }
        if (z !== this.releasedThrough + 1 || this.layers[z] === null) {
            throw new Error(`Layer ${z} is not available to release`);
        }
        this.layers[z] = null;
        this.releasedThrough = z;
    }
}

function createGrid(settings) {
    const { cols, rows } = settings.grid;
    const { numGenerations, retainHistory } = settings.simulation;
    const positionScale = settings.simulation.algorithm === "PN" && settings.pn.movementUnit !== null
        ? settings.pn.ticksPerCell : null;
    return new StateGrid(cols, rows, numGenerations, retainHistory, positionScale);
}

function wrapIndex(index, size) {
    return ((index % size) + size) % size;
}
