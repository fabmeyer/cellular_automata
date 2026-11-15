// One byte per cell: states are validated to 2..9 (see config.js), so Uint8Array is enough.
// Each layer is its own buffer, so very large volumes never need a single multi-GiB allocation.
class StateGrid {
    constructor(cols, rows, depth, retainHistory = true) {
        this.cols = cols;
        this.rows = rows;
        this.depth = depth;
        this.retainHistory = retainHistory;
        this.layers = Array.from({ length: depth }, () =>
            retainHistory ? new Uint8Array(cols * rows) : null);
        this.releasedThrough = -1;
    }

    reset() {
        this.layers = Array.from({ length: this.depth }, () =>
            this.retainHistory ? new Uint8Array(this.cols * this.rows) : null);
        this.releasedThrough = -1;
    }

    // Layer layout is x-major (index = x * rows + y), matching the renderer's state texture.
    layer(z) {
        if (!Number.isInteger(z) || z < 0 || z >= this.depth) {
            throw new RangeError(`Layer index out of bounds: ${z}`);
        }
        if (z <= this.releasedThrough) {
            throw new Error(`Layer ${z} has already been released`);
        }
        if (this.layers[z] === null) {
            this.layers[z] = new Uint8Array(this.cols * this.rows);
        }
        return this.layers[z];
    }

    get(x, y, z) {
        return this.layer(z)[x * this.rows + y];
    }

    set(x, y, z, state) {
        this.layer(z)[x * this.rows + y] = state;
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
    return new StateGrid(cols, rows, numGenerations, retainHistory);
}

function wrapIndex(index, size) {
    return ((index % size) + size) % size;
}
