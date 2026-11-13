const MOVEMENT_DIRECTIONS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [0, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
];

class PerlinMovement {
    constructor(settings, random, noiseField) {
        if (typeof noiseField !== "function") {
            throw new Error("PN requires a noise function");
        }
        this.settings = settings;
        this.random = random;
        this.noise = noiseField;
        this.history = new Map();
        this.ruleMap = new Map();
        const { forwardProbability } = settings.pn;
        for (const [dx, dy] of MOVEMENT_DIRECTIONS) {
            const alternatives = MOVEMENT_DIRECTIONS.filter(([x, y]) => x !== dx || y !== dy);
            this.ruleMap.set(`move:${dx},${dy}`, [
                { dx, dy, probability: forwardProbability },
                ...alternatives.map(([x, y]) => ({
                    dx: x, dy: y, probability: (1 - forwardProbability) / alternatives.length
                }))
            ]);
        }
    }

    perlinDirection(x, y, z) {
        const { noiseSpaceScale, noiseTimeScale } = this.settings.pn;
        const value = this.noise(x * noiseSpaceScale, y * noiseSpaceScale, z * noiseTimeScale);
        return MOVEMENT_DIRECTIONS[Math.min(Math.floor(value * MOVEMENT_DIRECTIONS.length),
            MOVEMENT_DIRECTIONS.length - 1)];
    }

    initialize(grid) {
        this.history.clear();
        const { cols, rows } = this.settings.grid;
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                if (grid[x][y][0].state !== 0) {
                    this.history.set(x * rows + y, this.perlinDirection(x, y, 0));
                }
            }
        }
    }

    chooseMovement(direction, sample) {
        const outcomes = this.ruleMap.get(`move:${direction[0]},${direction[1]}`);
        if (!outcomes) {
            throw new Error(`Missing movement rule for direction ${direction}`);
        }
        let cumulative = 0;
        for (const [index, outcome] of outcomes.entries()) {
            cumulative += outcome.probability;
            const upper = index === outcomes.length - 1 ? 1 : cumulative;
            if (sample >= 0 && sample < upper && outcome.probability > 0) {
                return outcome;
            }
        }
        throw new Error(`Invalid movement sample or probability distribution: ${sample}`);
    }

    step(grid, z) {
        const { cols, rows } = this.settings.grid;
        const { noiseSpaceScale, noiseTimeScale } = this.settings.pn;
        const phase = this.random();
        const arrivals = new Map();
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                setGridCell(grid, this.settings, x, y, z, 0);
                const state = grid[x][y][z - 1].state;
                if (state === 0) {
                    continue;
                }
                const direction = this.history.get(x * rows + y);
                if (!direction) {
                    throw new Error(`Missing movement history for occupied cell (${x}, ${y})`);
                }
                const sample = (this.noise(x * noiseSpaceScale, y * noiseSpaceScale,
                    (z - 1) * noiseTimeScale) + phase) % 1;
                const move = this.chooseMovement(direction, sample);
                const targetX = wrapIndex(x + move.dx, cols);
                const targetY = wrapIndex(y + move.dy, rows);
                const key = targetX * rows + targetY;
                const arrival = arrivals.get(key) || { direction: [0, 0], state: 0 };
                arrival.direction[0] += move.dx;
                arrival.direction[1] += move.dy;
                arrival.state = Math.max(arrival.state, state);
                arrivals.set(key, arrival);
            }
        }
        const nextHistory = new Map();
        for (const [key, arrival] of arrivals) {
            const x = Math.floor(key / rows);
            const y = key % rows;
            grid[x][y][z].state = arrival.state;
            nextHistory.set(key, arrival.direction.map(Math.sign));
        }
        this.history = nextHistory;
    }
}
