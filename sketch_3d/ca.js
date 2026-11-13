class CellularAutomaton {
    constructor(settings, random) {
        this.settings = settings;
        this.random = random;
        this.ruleMap = new Map();
        this.lastLayerRuleKeys = null;
    }

    initialize() {
        this.ruleMap.clear();
        this.lastLayerRuleKeys = null;
    }

    resolveState(counts, currentState) {
        this.lastRuleKey = null;
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
        this.lastRuleKey = key;
        return this.ruleMap.get(key);
    }

    mutateOneRule(ruleKeys) {
        const frequencies = new Map();
        for (const key of ruleKeys) {
            if (this.ruleMap.has(key)) {
                frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
            }
        }
        if (frequencies.size === 0) {
            return null;
        }

        let selectedKey = null;
        let selectedCount = 0;
        for (const [key, count] of frequencies) {
            if (count > selectedCount) {
                selectedKey = key;
                selectedCount = count;
            }
        }
        const previousState = this.ruleMap.get(selectedKey);
        const state = (previousState + 1) % this.settings.simulation.states;
        this.ruleMap.set(selectedKey, state);
        return { key: selectedKey, previousState, state };
    }

    step(grid, z) {
        const { cols, rows } = this.settings.grid;
        const radius = Math.floor(this.settings.ca.neighborhoodSize / 2);
        this.lastLayerRuleKeys = Array.from({ length: cols }, () => new Array(rows).fill(null));
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                const counts = new Array(this.settings.simulation.states).fill(0);
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        counts[grid[wrapIndex(x + dx, cols)][wrapIndex(y + dy, rows)][z - 1].state]++;
                    }
                }
                const state = this.resolveState(counts, grid[x][y][z - 1].state);
                this.lastLayerRuleKeys[x][y] = this.lastRuleKey;
                setGridCell(grid, this.settings, x, y, z, state);
            }
        }
    }
}
