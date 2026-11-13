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
        this.trajectories = new Map();
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
        const value = this.settings.pn.mode === "trajectory"
            ? this.checkedNoise(x * noiseSpaceScale, y * noiseSpaceScale, z * noiseTimeScale)
            : this.noise(x * noiseSpaceScale, y * noiseSpaceScale, z * noiseTimeScale);
        return MOVEMENT_DIRECTIONS[Math.min(Math.floor(value * MOVEMENT_DIRECTIONS.length),
            MOVEMENT_DIRECTIONS.length - 1)];
    }

    checkedNoise(x, y, z) {
        const value = this.noise(x, y, z);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error(`Invalid PN trajectory noise sample: ${value}; expected a number in [0, 1]`);
        }
        return value;
    }

    sampleTrajectory(x, y, direction) {
        const { parameterNoise, ...ranges } = this.settings.pn.trajectory;
        const nx = x * parameterNoise.spaceScale;
        const ny = y * parameterNoise.spaceScale;
        const shared = parameterNoise.channels === "shared" ? this.checkedNoise(nx, ny, 1) : null;
        const parameters = {};
        for (const [index, name] of TRAJECTORY_PARAMETERS.entries()) {
            // Integer z offsets below p5's z period keep the parameter fields distinct.
            const sample = shared ?? this.checkedNoise(nx, ny, index + 1);
            const [min, max] = ranges[name];
            parameters[name] = min + sample * (max - min);
        }
        return { direction: [...direction], parameters, offset: [0, 0], origin: { z: 0, offset: [0, 0] } };
    }

    initialize(grid) {
        this.history.clear();
        this.trajectories.clear();
        const { cols, rows } = this.settings.grid;
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                if (grid[x][y][0].state !== 0) {
                    const key = x * rows + y;
                    const direction = this.perlinDirection(x, y, 0);
                    this.history.set(key, direction);
                    if (this.settings.pn.mode === "trajectory") {
                        this.trajectories.set(key, this.sampleTrajectory(x, y, direction));
                    }
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
        if (this.settings.pn.mode === "trajectory") {
            this.stepTrajectory(grid, z);
            return;
        }
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

    trajectoryMovement(trajectory, z) {
        const { slope, bend, amplitude, wavelength, phase } = trajectory.parameters;
        const elapsed = z - trajectory.origin.z;
        let displacement = slope * elapsed + bend * elapsed * (z + trajectory.origin.z) / 2;
        if (amplitude !== 0) {
            const frequency = 2 * Math.PI / wavelength;
            displacement += amplitude * (Math.sin(frequency * z + phase) -
                Math.sin(frequency * trajectory.origin.z + phase));
        }
        // Evaluate from the retained origin instead of accumulating decimal rounding errors.
        const offset = trajectory.origin.offset.map((value, axis) =>
            value + trajectory.direction[axis] * displacement);
        const direction = offset.map((value, axis) => {
            const movement = Math.trunc(value) - Math.trunc(trajectory.offset[axis]);
            return movement === 0 ? 0 : movement;
        });
        if (direction.some(value => !Number.isInteger(value) || Math.abs(value) > 1)) {
            throw new Error(`PN trajectory exceeded one cell per axis at layer ${z}`);
        }
        return { direction, trajectory: { ...trajectory, offset } };
    }

    mergeTrajectories(trajectories, z) {
        if (trajectories.length === 1) {
            return trajectories[0];
        }
        const count = trajectories.length;
        const direction = [0, 0];
        const offset = [0, 0];
        const parameters = Object.fromEntries(TRAJECTORY_PARAMETERS.map(name => [name, 0]));
        let phaseSin = 0;
        let phaseCos = 0;
        for (const trajectory of trajectories) {
            for (let axis = 0; axis < 2; axis++) {
                direction[axis] += trajectory.direction[axis] / count;
                // Rebase only at collisions, preserving sub-cell progress without teleporting.
                offset[axis] += (trajectory.offset[axis] - Math.trunc(trajectory.offset[axis])) / count;
            }
            for (const name of TRAJECTORY_PARAMETERS) {
                if (name !== "phase") {
                    parameters[name] += trajectory.parameters[name] / count;
                }
            }
            phaseSin += Math.sin(trajectory.parameters.phase);
            phaseCos += Math.cos(trajectory.parameters.phase);
        }
        parameters.phase = Math.hypot(phaseSin, phaseCos) <= count * Number.EPSILON * 4
            ? 0 : Math.atan2(phaseSin, phaseCos);
        return { direction, parameters, offset, origin: { z, offset } };
    }

    stepTrajectory(grid, z) {
        const { cols, rows } = this.settings.grid;
        const { noiseSpaceScale, noiseTimeScale } = this.settings.pn;
        const phase = this.random();
        if (!Number.isFinite(phase) || phase < 0 || phase >= 1) {
            throw new Error(`Invalid PN trajectory movement phase: ${phase}; expected a number in [0, 1)`);
        }
        const arrivals = new Map();
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                setGridCell(grid, this.settings, x, y, z, 0);
                const state = grid[x][y][z - 1].state;
                if (state === 0) {
                    continue;
                }
                const trajectory = this.trajectories.get(x * rows + y);
                if (!trajectory) {
                    throw new Error(`Missing trajectory history for occupied cell (${x}, ${y})`);
                }
                const planned = this.trajectoryMovement(trajectory, z);
                const sample = (this.checkedNoise(x * noiseSpaceScale, y * noiseSpaceScale,
                    (z - 1) * noiseTimeScale) + phase) % 1;
                const move = this.chooseMovement(planned.direction, sample);
                const key = wrapIndex(x + move.dx, cols) * rows + wrapIndex(y + move.dy, rows);
                const arrival = arrivals.get(key) || { state: 0, direction: [0, 0], trajectories: [] };
                arrival.state = Math.max(arrival.state, state);
                arrival.direction[0] += move.dx;
                arrival.direction[1] += move.dy;
                arrival.trajectories.push(planned.trajectory);
                arrivals.set(key, arrival);
            }
        }
        const nextHistory = new Map();
        const nextTrajectories = new Map();
        for (const [key, arrival] of arrivals) {
            grid[Math.floor(key / rows)][key % rows][z].state = arrival.state;
            nextHistory.set(key, arrival.direction.map(Math.sign));
            nextTrajectories.set(key, this.mergeTrajectories(arrival.trajectories, z));
        }
        this.history = nextHistory;
        this.trajectories = nextTrajectories;
    }
}
