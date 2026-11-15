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
        this.tracksProgress = settings.pn.mode === "trajectory" || settings.pn.slope !== null;
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
        const value = this.sampleNoise(x, y, z);
        return MOVEMENT_DIRECTIONS[Math.min(Math.floor(value * MOVEMENT_DIRECTIONS.length),
            MOVEMENT_DIRECTIONS.length - 1)];
    }

    sampleNoise(x, y, t, spaceScale = this.settings.pn.noiseSpaceScale, channel = 0) {
        const { noiseDrift, noiseTimeScale, mode, noiseSteering } = this.settings.pn;
        const nx = x * spaceScale - t * noiseDrift[0];
        const ny = y * spaceScale - t * noiseDrift[1];
        const nt = channel + t * noiseTimeScale;
        return mode === "trajectory" || noiseSteering
            ? this.checkedNoise(nx, ny, nt) : this.noise(nx, ny, nt);
    }

    checkedNoise(x, y, z) {
        const value = this.noise(x, y, z);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            const kind = this.settings.pn.mode === "trajectory" ? "trajectory" : "steering";
            throw new Error(`Invalid PN ${kind} noise sample: ${value}; expected a number in [0, 1]`);
        }
        return value;
    }

    sampleTrajectory(x, y, direction, t = 0) {
        const { parameterNoise, ...ranges } = this.settings.pn.trajectory;
        const shared = parameterNoise.channels === "shared"
            ? this.sampleNoise(x, y, t, parameterNoise.spaceScale, 1) : null;
        const parameters = {};
        for (const [index, name] of TRAJECTORY_PARAMETERS.entries()) {
            // Integer z offsets below p5's z period keep the parameter fields distinct.
            const sample = shared ?? this.sampleNoise(x, y, t, parameterNoise.spaceScale, index + 1);
            const [min, max] = ranges[name];
            parameters[name] = min + sample * (max - min);
        }
        return { direction: [...direction], parameters, offset: [0, 0], origin: { z: 0, offset: [0, 0] } };
    }

    sampleLinear(x, y, direction, t = 0) {
        const [min, max] = this.settings.pn.slope;
        const sample = min === max ? 0 : this.checkedNoise(
            x * this.settings.pn.noiseSpaceScale - t * this.settings.pn.noiseDrift[0],
            y * this.settings.pn.noiseSpaceScale - t * this.settings.pn.noiseDrift[1],
            t * this.settings.pn.noiseTimeScale);
        return { direction: [...direction],
            parameters: { slope: min + sample * (max - min), bend: 0, amplitude: 0, wavelength: 1, phase: 0 },
            offset: [0, 0], origin: { z: 0, offset: [0, 0] } };
    }

    initialTrajectory(x, y, direction) {
        return this.settings.pn.mode === "trajectory"
            ? this.sampleTrajectory(x, y, direction) : this.sampleLinear(x, y, direction);
    }

    selectedTrajectory(planned, move, z) {
        if (this.settings.pn.mode !== "legacy" ||
            (move.dx === planned.direction[0] && move.dy === planned.direction[1])) {
            return planned.trajectory;
        }
        const offset = planned.trajectory.offset.map(value => value - Math.trunc(value));
        return { ...planned.trajectory, direction: [Math.sign(move.dx), Math.sign(move.dy)],
            offset, origin: { z, offset } };
    }

    initialize(grid) {
        this.history.clear();
        this.trajectories.clear();
        grid.initializePositions();
        if (grid.positionsInitialized) {
            const scale = grid.positionScale;
            for (const [key, cell] of grid.layer(0)) {
                const direction = this.perlinDirection(cell.x / scale, cell.y / scale, 0);
                this.history.set(key, direction);
                if (this.tracksProgress) {
                    this.trajectories.set(key, this.initialTrajectory(cell.x / scale, cell.y / scale, direction));
                }
            }
            return;
        }
        if (this.settings.pn.boundary === "grow") {
            grid.outsideLayers = [];
        }
        const { cols, rows } = this.settings.grid;
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                if (grid.get(x, y, 0) !== 0) {
                    const key = this.settings.pn.boundary === "grow" ? `${x},${y}` : x * rows + y;
                    const direction = this.perlinDirection(x, y, 0);
                    this.history.set(key, direction);
                    if (this.tracksProgress) {
                        this.trajectories.set(key, this.initialTrajectory(x, y, direction));
                    }
                }
            }
        }
    }

    chooseMovement(direction, sample) {
        const limit = this.settings.pn.maxCellsPerAxisPerLayer * this.settings.pn.ticksPerCell;
        if (!Array.isArray(direction) || direction.length !== 2 ||
            !direction.every(value => Number.isInteger(value) && Math.abs(value) <= limit)) {
            throw new Error(`Invalid movement direction ${direction}; maximum ${limit} cells per axis`);
        }
        const heading = direction.map(Math.sign);
        const outcomes = this.ruleMap.get(`move:${heading[0]},${heading[1]}`);
        if (!outcomes) {
            throw new Error(`Missing movement rule for direction ${direction}`);
        }
        let cumulative = 0;
        for (const [index, outcome] of outcomes.entries()) {
            cumulative += outcome.probability;
            const upper = index === outcomes.length - 1 ? 1 : cumulative;
            if (sample >= 0 && sample < upper && outcome.probability > 0) {
                if (index === 0 && (outcome.dx !== direction[0] || outcome.dy !== direction[1])) {
                    return { ...outcome, dx: direction[0], dy: direction[1] };
                }
                return outcome;
            }
        }
        throw new Error(`Invalid movement sample or probability distribution: ${sample}`);
    }

    step(grid, z) {
        if (grid.positionsInitialized) {
            this.stepPositions(grid, z);
            return;
        }
        if (this.settings.pn.boundary === "grow") {
            this.stepOutward(grid, z);
            return;
        }
        if (this.tracksProgress) {
            this.stepTrajectory(grid, z);
            return;
        }
        const { cols, rows } = this.settings.grid;
        const { noiseSteering, maxCellsPerAxisPerLayer } = this.settings.pn;
        const phase = this.random();
        if (noiseSteering && (!Number.isFinite(phase) || phase < 0 || phase >= 1)) {
            throw new Error(`Invalid PN steering movement phase: ${phase}; expected a number in [0, 1)`);
        }
        const arrivals = new Map();
        const previous = grid.layer(z - 1);
        const next = grid.layer(z);
        next.fill(0);
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                const state = previous[x * rows + y];
                if (state === 0) {
                    continue;
                }
                const direction = this.history.get(x * rows + y);
                if (!direction) {
                    throw new Error(`Missing movement history for occupied cell (${x}, ${y})`);
                }
                const sample = (this.sampleNoise(x, y, z - 1) + phase) % 1;
                const heading = noiseSteering ? this.perlinDirection(x, y, z - 1) : direction;
                const preferred = heading.map(value => value * maxCellsPerAxisPerLayer);
                const move = this.chooseMovement(preferred, sample);
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
            next[key] = arrival.state;
            nextHistory.set(key, arrival.direction.map(Math.sign));
        }
        this.history = nextHistory;
    }

    stepOutward(grid, z) {
        const { cols, rows } = this.settings.grid;
        const { mode, noiseSteering, maxCellsPerAxisPerLayer } = this.settings.pn;
        const phase = this.random();
        if ((this.tracksProgress || noiseSteering) && (!Number.isFinite(phase) || phase < 0 || phase >= 1)) {
            throw new Error(`Invalid PN ${mode === "trajectory" ? "trajectory" : "steering"} ` +
                `movement phase: ${phase}; expected a number in [0, 1)`);
        }
        const arrivals = new Map();
        const moveCell = (x, y, state) => {
            if (state === 0) {
                return;
            }
            const key = `${x},${y}`;
            const trajectory = this.tracksProgress ? this.trajectories.get(key) : null;
            const direction = this.history.get(key);
            if (this.tracksProgress && !trajectory) {
                throw new Error(`Missing trajectory history for occupied cell (${x}, ${y})`);
            }
            if (!this.tracksProgress && !direction) {
                throw new Error(`Missing movement history for occupied cell (${x}, ${y})`);
            }
            const planned = trajectory ? this.trajectoryMovement(trajectory, z, x, y) : null;
            const heading = !trajectory && noiseSteering ? this.perlinDirection(x, y, z - 1) : direction;
            const preferred = planned ? planned.direction : heading.map(value => value * maxCellsPerAxisPerLayer);
            const noiseValue = this.sampleNoise(x, y, z - 1);
            const sample = (noiseValue + phase) % 1;
            const move = this.chooseMovement(preferred, sample);
            const targetX = x + move.dx;
            const targetY = y + move.dy;
            if (!Number.isSafeInteger(targetX) || !Number.isSafeInteger(targetY)) {
                throw new Error(`PN outward coordinates exceed safe integer range at layer ${z}`);
            }
            const targetKey = `${targetX},${targetY}`;
            const arrival = arrivals.get(targetKey) ||
                { x: targetX, y: targetY, state: 0, direction: [0, 0], trajectories: [] };
            arrival.state = Math.max(arrival.state, state);
            arrival.direction[0] += move.dx;
            arrival.direction[1] += move.dy;
            if (planned) {
                arrival.trajectories.push(this.selectedTrajectory(planned, move, z));
            }
            arrivals.set(targetKey, arrival);
        };
        const previous = grid.layer(z - 1);
        grid.layer(z).fill(0);
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                moveCell(x, y, previous[x * rows + y]);
            }
        }
        for (const cell of grid.outsideLayers[z - 1]?.values() ?? []) {
            moveCell(cell.x, cell.y, cell.state);
        }
        const nextHistory = new Map();
        const nextTrajectories = new Map();
        const outside = new Map();
        for (const [key, arrival] of arrivals) {
            const { x, y, state } = arrival;
            if (x >= 0 && x < cols && y >= 0 && y < rows) {
                grid.set(x, y, z, state);
            } else {
                outside.set(key, { x, y, state });
            }
            nextHistory.set(key, arrival.direction.map(Math.sign));
            if (this.tracksProgress) {
                nextTrajectories.set(key, this.mergeTrajectories(arrival.trajectories, z, arrival.direction));
            }
        }
        grid.outsideLayers[z] = outside;
        this.history = nextHistory;
        this.trajectories = nextTrajectories;
    }

    trajectoryMovement(trajectory, z, x, y) {
        let nextTrajectory;
        if (this.settings.pn.mode === "legacy" && this.settings.pn.noiseSteering) {
            const heading = this.perlinDirection(x, y, z - 1);
            const sampled = this.sampleLinear(x, y, heading, z - 1);
            const offset = trajectory.offset.map((value, axis) =>
                value + heading[axis] * sampled.parameters.slope);
            nextTrajectory = { ...trajectory, direction: heading, parameters: sampled.parameters, offset };
        } else if (this.settings.pn.noiseSteering) {
            nextTrajectory = this.steerTrajectory(trajectory, z, x, y);
        } else {
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
            nextTrajectory = { ...trajectory, offset };
        }
        const direction = nextTrajectory.offset.map((value, axis) => {
            const movement = Math.trunc(value) - Math.trunc(trajectory.offset[axis]);
            return movement === 0 ? 0 : movement;
        });
        const limit = this.settings.pn.maxCellsPerAxisPerLayer * this.settings.pn.ticksPerCell;
        if (direction.some(value => !Number.isInteger(value) || Math.abs(value) > limit)) {
            throw new Error(`PN trajectory exceeded ${limit} cells per axis at layer ${z}`);
        }
        return { direction, trajectory: nextTrajectory };
    }

    steerTrajectory(trajectory, z, x, y) {
        const heading = this.perlinDirection(x, y, z - 1);
        const sampled = this.sampleTrajectory(x, y, heading, z - 1);
        const { slope, bend, amplitude, wavelength, phase } = sampled.parameters;
        const frequency = 2 * Math.PI / wavelength;
        // Difference the curve with one parameter set, not two differently sampled positions.
        const increment = slope + bend * (z - 0.5) +
            2 * amplitude * Math.cos(frequency * (z - 0.5) + phase) * Math.sin(frequency / 2);
        const offset = trajectory.offset.map((value, axis) => value + heading[axis] * increment);
        return { ...trajectory, direction: [...heading], parameters: sampled.parameters, offset };
    }

    mergeTrajectories(trajectories, z, movementDirection = null) {
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
        return { direction: this.settings.pn.mode === "legacy"
            ? (movementDirection ?? direction).map(Math.sign) : direction,
            parameters, offset, origin: { z, offset } };
    }

    stepTrajectory(grid, z) {
        const { cols, rows } = this.settings.grid;
        const phase = this.random();
        if (!Number.isFinite(phase) || phase < 0 || phase >= 1) {
            throw new Error(`Invalid PN trajectory movement phase: ${phase}; expected a number in [0, 1)`);
        }
        const arrivals = new Map();
        const previous = grid.layer(z - 1);
        const next = grid.layer(z);
        next.fill(0);
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                const state = previous[x * rows + y];
                if (state === 0) {
                    continue;
                }
                const trajectory = this.trajectories.get(x * rows + y);
                if (!trajectory) {
                    throw new Error(`Missing trajectory history for occupied cell (${x}, ${y})`);
                }
                const planned = this.trajectoryMovement(trajectory, z, x, y);
                const sample = (this.sampleNoise(x, y, z - 1) + phase) % 1;
                const move = this.chooseMovement(planned.direction, sample);
                const key = wrapIndex(x + move.dx, cols) * rows + wrapIndex(y + move.dy, rows);
                const arrival = arrivals.get(key) || { state: 0, direction: [0, 0], trajectories: [] };
                arrival.state = Math.max(arrival.state, state);
                arrival.direction[0] += move.dx;
                arrival.direction[1] += move.dy;
                arrival.trajectories.push(this.selectedTrajectory(planned, move, z));
                arrivals.set(key, arrival);
            }
        }
        const nextHistory = new Map();
        const nextTrajectories = new Map();
        for (const [key, arrival] of arrivals) {
            next[key] = arrival.state;
            nextHistory.set(key, arrival.direction.map(Math.sign));
            nextTrajectories.set(key, this.mergeTrajectories(arrival.trajectories, z, arrival.direction));
        }
        this.history = nextHistory;
        this.trajectories = nextTrajectories;
    }

    wrapPosition(value, count, scale, movement) {
        const width = count * scale;
        const maximum = width - scale;
        const wrapped = wrapIndex(value, width);
        return wrapped <= maximum ? wrapped : movement > 0 ? 0 : maximum;
    }

    stepPositions(grid, z) {
        const { cols, rows } = this.settings.grid;
        const { boundary, noiseSteering, maxCellsPerAxisPerLayer } = this.settings.pn;
        const scale = grid.positionScale;
        const phase = this.random();
        if (!Number.isFinite(phase) || phase < 0 || phase >= 1) {
            throw new Error(`Invalid PN position movement phase: ${phase}; expected a number in [0, 1)`);
        }
        const arrivals = new Map();
        for (const [key, cell] of grid.layer(z - 1)) {
            const direction = this.history.get(key);
            if (!direction) {
                throw new Error(`Missing movement history for occupied position (${cell.x}, ${cell.y})`);
            }
            const x = cell.x / scale;
            const y = cell.y / scale;
            const trajectory = this.tracksProgress ? this.trajectories.get(key) : null;
            if (this.tracksProgress && !trajectory) {
                throw new Error(`Missing trajectory history for occupied position (${cell.x}, ${cell.y})`);
            }
            const planned = trajectory ? this.trajectoryMovement(trajectory, z, x, y) : null;
            const heading = !trajectory && noiseSteering ? this.perlinDirection(x, y, z - 1) : direction;
            const preferred = planned ? planned.direction : heading.map(value => value * maxCellsPerAxisPerLayer);
            const move = this.chooseMovement(preferred, (this.sampleNoise(x, y, z - 1) + phase) % 1);
            let targetX = cell.x + move.dx;
            let targetY = cell.y + move.dy;
            if (!Number.isSafeInteger(targetX) || !Number.isSafeInteger(targetY)) {
                throw new Error(`PN position coordinates exceed safe integer range at layer ${z}`);
            }
            if (boundary === "wrap") {
                targetX = this.wrapPosition(targetX, cols, scale, move.dx);
                targetY = this.wrapPosition(targetY, rows, scale, move.dy);
            }
            const targetKey = `${targetX},${targetY}`;
            const arrival = arrivals.get(targetKey) ??
                { x: targetX, y: targetY, state: 0, direction: [0, 0], trajectories: [] };
            arrival.state = Math.max(arrival.state, cell.state);
            arrival.direction[0] += move.dx;
            arrival.direction[1] += move.dy;
            if (planned) {
                arrival.trajectories.push(this.selectedTrajectory(planned, move, z));
            }
            arrivals.set(targetKey, arrival);
        }
        const merged = this.mergeFootprints([...arrivals.values()], scale, z);
        merged.sort((a, b) => a.x - b.x || a.y - b.y);
        const next = grid.layer(z);
        next.clear();
        this.history = new Map();
        this.trajectories = new Map();
        for (const arrival of merged) {
            const { x, y, state, direction, trajectory } = arrival;
            const key = `${x},${y}`;
            next.set(key, { x, y, state });
            this.history.set(key, direction);
            if (trajectory) {
                this.trajectories.set(key, trajectory);
            }
        }
    }

    mergeFootprints(arrivals, scale, z) {
        const parents = arrivals.map((_, index) => index);
        const find = index => {
            let root = index;
            while (parents[root] !== root) {
                root = parents[root];
            }
            while (parents[index] !== index) {
                const next = parents[index];
                parents[index] = root;
                index = next;
            }
            return root;
        };
        const buckets = new Map();
        for (const [index, arrival] of arrivals.entries()) {
            const bx = Math.floor(arrival.x / scale);
            const by = Math.floor(arrival.y / scale);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
                        if (Math.abs(arrival.x - arrivals[other].x) < scale &&
                            Math.abs(arrival.y - arrivals[other].y) < scale) {
                            parents[find(index)] = find(other);
                        }
                    }
                }
            }
            const key = `${bx},${by}`;
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(index);
        }
        const groups = new Map();
        for (const [index, arrival] of arrivals.entries()) {
            const root = find(index);
            if (!groups.has(root)) {
                groups.set(root, []);
            }
            groups.get(root).push(arrival);
        }
        return [...groups.values()].map(group => {
            group.sort((a, b) => b.state - a.state || a.x - b.x || a.y - b.y);
            const { x, y, state } = group[0];
            const direction = [0, 0];
            const trajectories = [];
            for (const arrival of group) {
                direction[0] += arrival.direction[0];
                direction[1] += arrival.direction[1];
                trajectories.push(...arrival.trajectories);
            }
            return { x, y, state, direction: direction.map(Math.sign),
                trajectory: this.tracksProgress ? this.mergeTrajectories(trajectories, z, direction) : null };
        });
    }
}
