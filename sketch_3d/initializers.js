function d4Representative(i, j, size) {
    const transforms = [
        [i, j], [j, size - 1 - i], [size - 1 - i, size - 1 - j], [size - 1 - j, i],
        [i, size - 1 - j], [size - 1 - i, j], [j, i], [size - 1 - j, size - 1 - i]
    ];
    return transforms.reduce((best, candidate) =>
        candidate[0] * size + candidate[1] < best[0] * size + best[1] ? candidate : best);
}

function initializeGrid(grid, settings, random) {
    const { cols, rows } = settings.grid;
    const { mode, patternSize, symmetry, placement } = settings.initial;
    const randomState = () => Math.floor(random() * settings.simulation.states);
    for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
            setGridCell(grid, settings, x, y, 0, mode === "random" ? randomState() : 0);
        }
    }
    if (mode === "random") {
        return;
    }
    const seed = Array.from({ length: patternSize }, () =>
        Array.from({ length: patternSize }, randomState));
    function seedState(x, y) {
        const [i, j] = symmetry === "D4" ? d4Representative(x, y, patternSize) : [x, y];
        return seed[i][j];
    }
    if (placement === "tiled") {
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                setGridCell(grid, settings, x, y, 0, seedState(x % patternSize, y % patternSize));
            }
        }
        return;
    }
    const origins = placement === "center"
        ? [[Math.floor((cols - patternSize) / 2), Math.floor((rows - patternSize) / 2)]]
        : [[0, 0], [cols - patternSize, 0], [0, rows - patternSize],
            [cols - patternSize, rows - patternSize]];
    // Overlapping corner blocks are stamped in this order; the last stamp wins.
    for (const [originX, originY] of origins) {
        for (let x = 0; x < patternSize; x++) {
            for (let y = 0; y < patternSize; y++) {
                setGridCell(grid, settings, originX + x, originY + y, 0, seedState(x, y));
            }
        }
    }
}
