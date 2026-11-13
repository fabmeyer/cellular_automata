class RowMemory {
    constructor(settings) {
        this.items = [];
        this.hashes = [];
        this.zIndices = [];
        this.capacity = settings.memoryCapacity;
        this.rowLength = settings.grid.rows;
        this.matchRunLength = settings.matchRunLength;
        this.quarterDepth = Math.floor(settings.depth / 4);
        this.head = 0;
        this.periodRuns = new Map();
        this.latestPeriod = null;
        this.latestRuleKeys = [];
        this.notifiedPeriods = new Set();
    }

    extractRowStates(grid, zIndex) {
        const row = new Uint8Array(this.rowLength);
        for (let y = 0; y < this.rowLength; y++) {
            row[y] = grid[0][y][zIndex].state;
        }
        return row;
    }

    hashRow(row) {
        let hash = 2166136261;
        for (const state of row) {
            hash ^= state;
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    addLayer(grid, zIndex, ruleKeys = null) {
        const row = this.extractRowStates(grid, zIndex);
        const hash = this.hashRow(row);
        const nextRuns = new Map();
        this.latestPeriod = null;
        this.latestRuleKeys = [];

        for (let i = 0; i < this.items.length; i++) {
            const period = zIndex - this.zIndices[i];
            if (this.hashes[i] === hash && row.every((state, y) => state === this.items[i][y])) {
                const runLength = (this.periodRuns.get(period) ?? 0) + 1;
                nextRuns.set(period, runLength);
                const requiredRunLength = this.quarterDepth > 0 && period <= this.quarterDepth
                    ? Math.min(this.matchRunLength, this.quarterDepth) : this.matchRunLength;
                if (runLength >= requiredRunLength &&
                    (this.latestPeriod === null || period < this.latestPeriod)) {
                    this.latestPeriod = period;
                }
            }
        }
        this.periodRuns = nextRuns;

        if (this.latestPeriod !== null && ruleKeys) {
            this.latestRuleKeys = ruleKeys[0].filter(key => key !== null);
        }
        this.items[this.head] = row;
        this.hashes[this.head] = hash;
        this.zIndices[this.head] = zIndex;
        this.head = (this.head + 1) % this.capacity;
        return this.latestPeriod !== null;
    }

    markNotified() {
        this.notifiedPeriods.add(this.latestPeriod);
    }

    getLatestRow() {
        return this.items.length === 0 ? null : this.items[(this.head + this.items.length - 1) % this.items.length];
    }
}
