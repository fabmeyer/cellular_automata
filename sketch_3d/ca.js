class CellularAutomaton {
    constructor(settings, random) {
        this.settings = settings;
        this.random = random;
        this.ruleMap = new Map();
    }

    initialize() {
        this.ruleMap.clear();
    }

    resolveState(counts, currentState) {
        const { states } = this.settings.simulation;
        const { rule, cycleUniform, emptyStateProbability, neighborhoodSize } = this.settings.ca;
        const neighborCount = neighborhoodSize ** 2;
        if (cycleUniform) {
            const uniformState = counts.indexOf(neighborCount);
            if (uniformState !== -1) {
                return (uniformState + 1) % states;
            }
        }
        if (rule === "majority") {
            const maximum = Math.max(...counts);
            const winners = counts.flatMap((count, state) => count === maximum ? [state] : []);
            return winners.length === 1 ? winners[0] : winners.includes(currentState) ? currentState : 0;
        }
        const key = rule === "counts"
            ? counts.join(",")
            : counts.reduce((sum, count, state) => sum + count * state, 0);
        if (!this.ruleMap.has(key)) {
            const state = this.random() < emptyStateProbability
                ? 0 : 1 + Math.floor(this.random() * (states - 1));
            this.ruleMap.set(key, state);
        }
        return this.ruleMap.get(key);
    }

    step(grid, z) {
        const { cols, rows } = this.settings.grid;
        const radius = Math.floor(this.settings.ca.neighborhoodSize / 2);
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                const counts = new Array(this.settings.simulation.states).fill(0);
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        counts[grid[wrapIndex(x + dx, cols)][wrapIndex(y + dy, rows)][z - 1].state]++;
                    }
                }
                const state = this.resolveState(counts, grid[x][y][z - 1].state);
                setGridCell(grid, this.settings, x, y, z, state);
            }
        }
    }
}
