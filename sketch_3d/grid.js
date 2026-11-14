// One byte per cell: states are validated to 2..9 (see config.js), so Uint8Array is enough.
// Each layer is its own buffer, so very large volumes never need a single multi-GiB allocation.
class StateGrid {
    constructor(cols, rows, depth) {
        this.cols = cols;
        this.rows = rows;
        this.depth = depth;
        this.layers = Array.from({ length: depth }, () => new Uint8Array(cols * rows));
    }

    // Layer layout is x-major (index = x * rows + y), matching the renderer's state texture.
    layer(z) {
        return this.layers[z];
    }

    get(x, y, z) {
        return this.layers[z][x * this.rows + y];
    }

    set(x, y, z, state) {
        this.layers[z][x * this.rows + y] = state;
    }
}

function createGrid(settings) {
    const { cols, rows } = settings.grid;
    return new StateGrid(cols, rows, settings.simulation.numGenerations);
}

function wrapIndex(index, size) {
    return ((index % size) + size) % size;
}
