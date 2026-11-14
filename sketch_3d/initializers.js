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
    const { mode, patternSize, resolutionFactor, symmetry, placement, loopPattern } = settings.initial;
    const randomState = () => Math.floor(random() * settings.simulation.states);
    if (mode === "random") {
        for (let x = 0; x < cols; x += resolutionFactor) {
            for (let y = 0; y < rows; y += resolutionFactor) {
                const state = randomState();
                const endX = Math.min(x + resolutionFactor, cols);
                const endY = Math.min(y + resolutionFactor, rows);
                for (let i = x; i < endX; i++) {
                    for (let j = y; j < endY; j++) {
                        grid.set(i, j, 0, state);
                    }
                }
            }
        }
        return;
    }
    for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
            grid.set(x, y, 0, 0);
        }
    }
    const coarseSize = patternSize / resolutionFactor;
    const seed = Array.from({ length: coarseSize }, () =>
        Array.from({ length: coarseSize }, randomState));
    function seedState(x, y) {
        const coarseX = Math.floor(x / resolutionFactor);
        const coarseY = Math.floor(y / resolutionFactor);
        const [i, j] = symmetry === "D4"
            ? d4Representative(coarseX, coarseY, coarseSize) : [coarseX, coarseY];
        return seed[i][j];
    }
    const origins = {
        tiled: [[0, 0]],
        center: [[Math.floor((cols - patternSize) / 2), Math.floor((rows - patternSize) / 2)]],
        corners: [[0, 0], [cols - patternSize, 0], [0, rows - patternSize],
            [cols - patternSize, rows - patternSize]]
    }[placement];
    // Tiled and center always loop; loopPattern only opts corner placement out of looping.
    if (placement !== "corners" || loopPattern) {
        // Loop the seed over the whole plane, aligned so the first placed block is one exact tile.
        const [anchorX, anchorY] = origins[0];
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                grid.set(x, y, 0,
                    seedState(wrapIndex(x - anchorX, patternSize), wrapIndex(y - anchorY, patternSize)));
            }
        }
    }
    if (placement === "tiled") {
        return;
    }
    // Overlapping corner blocks are stamped in this order; the last stamp wins.
    for (const [originX, originY] of origins) {
        for (let x = 0; x < patternSize; x++) {
            for (let y = 0; y < patternSize; y++) {
                grid.set(originX + x, originY + y, 0, seedState(x, y));
            }
        }
    }
}
