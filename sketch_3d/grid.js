class Cell {
    constructor(x, y, z, state) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.state = state;
    }
}

function createGrid(settings) {
    const { cols, rows } = settings.grid;
    return Array.from({ length: cols }, () =>
        Array.from({ length: rows }, () => new Array(settings.depth).fill(null)));
}

function wrapIndex(index, size) {
    return ((index % size) + size) % size;
}

function setGridCell(grid, settings, x, y, z, state) {
    grid[x][y][z] = new Cell(x * settings.grid.cellSize, y * settings.grid.cellSize, z, state);
}
