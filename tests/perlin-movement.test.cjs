const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness, plain, seededRandom } = require('./helpers.cjs');

function simulation(probability = 0.5, stateCount = 2, memoryEnabled = false) {
    let phase = 0;
    let noiseValue = () => 0;
    const { subject, classes } = createHarness({
        simulation: { algorithm: 'PN', states: stateCount },
        pn: { forwardProbability: probability, noiseSpaceScale: 0.05, noiseTimeScale: 0.05 },
        memory: { enabled: memoryEnabled },
        initial: { placement: 'corners', symmetry: 'D4', loopPattern: false }
    }, { random: () => phase, noise: (...args) => noiseValue(...args) });
    const algorithm = subject.algorithm;
    function seed(cells) {
        phase = 0;
        subject.initialize();
        algorithm.history.clear();
        for (const column of subject.grid) {
            for (const layers of column) {
                layers[0].state = 0;
            }
        }
        for (const [x, y, dx, dy, state = 1] of cells) {
            subject.grid[x][y][0].state = state;
            algorithm.history.set(x * subject.settings.grid.rows + y, [dx, dy]);
        }
    }
    return {
        subject, algorithm, seed,
        palette: () => new classes.GridRenderer(subject.settings).colors,
        phase(value) { phase = value; },
        noise(value) { noiseValue = typeof value === 'function' ? value : () => value; },
        occupied: () => plain(Array.from(algorithm.history, ([key, direction]) =>
            [Math.floor(key / 8), key % 8, ...direction]).sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    };
}

test('all direction maps have the configured probability intervals', () => {
    for (const probability of [0, 0.2, 0.5, 0.73, 1]) {
        const { algorithm } = simulation(probability);
        assert.equal(algorithm.ruleMap.size, 9);
        for (const [key, outcomes] of algorithm.ruleMap) {
            assert.equal(outcomes.length, 9);
            assert.equal(new Set(outcomes.map(o => `${o.dx},${o.dy}`)).size, 9);
            assert.equal(key, `move:${outcomes[0].dx},${outcomes[0].dy}`);
            let lower = 0;
            for (const [index, outcome] of outcomes.entries()) {
                const width = index === 0 ? probability : (1 - probability) / 8;
                assert.equal(outcome.probability, width);
                if (width > 0) {
                    assert.deepEqual(algorithm.chooseMovement([outcomes[0].dx, outcomes[0].dy],
                        lower + width / 2), outcome);
                }
                lower += width;
            }
            assert.ok(Math.abs(lower - 1) < 1e-14);
            assert.doesNotThrow(() => algorithm.chooseMovement([outcomes[0].dx, outcomes[0].dy],
                1 - Number.EPSILON));
        }
    }
});

test('invalid probability parameters fail explicitly', () => {
    for (const value of [-0.1, 1.1, NaN, Infinity, '0.5']) {
        assert.throws(() => simulation(value), /pn.forwardProbability must/);
    }
});

test('probability boundaries skip zero-weight outcomes and reject invalid samples', () => {
    const { algorithm } = simulation();
    assert.deepEqual(plain(algorithm.chooseMovement([1, 0], 0)), { dx: 1, dy: 0, probability: 0.5 });
    assert.deepEqual(plain(algorithm.chooseMovement([1, 0], 0.5)), { dx: -1, dy: -1, probability: 1 / 16 });
    assert.deepEqual(plain(algorithm.chooseMovement([1, 0], 0.75)), { dx: 0, dy: 0, probability: 1 / 16 });
    for (const value of [-0.1, 1, NaN]) {
        assert.throws(() => algorithm.chooseMovement([1, 0], value), /Invalid movement sample/);
    }
    assert.notEqual(simulation(0).algorithm.chooseMovement([1, 0], 0).dx, 1);
    assert.deepEqual(plain(simulation(1).algorithm.chooseMovement([1, 0], 1 - Number.EPSILON)),
        { dx: 1, dy: 0, probability: 1 });
    assert.throws(() => algorithm.chooseMovement([2, 0], 0), /Missing movement rule/);
});

test('left-to-center-to-right motion retains its direction and has exactly half the phase interval', () => {
    const sim = simulation();
    sim.noise(0.375);
    let forward = 0;
    for (let index = 0; index < 32; index++) {
        sim.seed([[2, 3, 1, 0]]);
        sim.phase((index + 0.5) / 32);
        sim.subject.step();
        if (sim.occupied()[0][0] === 3 && sim.occupied()[0][1] === 3) {
            forward++;
        }
    }
    assert.equal(forward, 16);
    sim.seed([[1, 3, 1, 0]]);
    sim.phase(0);
    sim.noise(0);
    sim.subject.step();
    sim.subject.step();
    assert.deepEqual(sim.occupied(), [[3, 3, 1, 0]]);
});

test('empty cells have no agency, layers remain valid, and missing history fails explicitly', () => {
    const sim = simulation();
    sim.seed([]);
    sim.subject.step();
    assert.deepEqual(sim.occupied(), []);
    assert.ok(sim.subject.grid.every(column => column.every(layers => layers[1]?.state === 0)));
    sim.seed([[1, 1, 1, 0]]);
    sim.algorithm.history.clear();
    assert.throws(() => sim.subject.step(), /Missing movement history/);
});

test('staying sets straight-up direction and diagonal seam movement keeps signed displacement', () => {
    const sim = simulation();
    sim.seed([[3, 3, 1, 0]]);
    sim.phase(0.78);
    sim.subject.step();
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
    sim.seed([[0, 7, -1, 1], [7, 0, 1, -1]]);
    sim.subject.step();
    assert.deepEqual(sim.occupied(), [[0, 7, 1, -1], [7, 0, -1, 1]]);
});

test('collisions merge occupancy and sum all vectors independent of arrival order or state', () => {
    for (const states of [[1, 1, 1], [2, 1, 1], [1, 1, 2], [2, 2, 2]]) {
        const sim = simulation(1, 3);
        for (const cells of [
            [[2, 3, 1, 0, states[0]], [3, 2, 0, 1, states[1]], [4, 3, -1, 0, states[2]]],
            [[3, 2, 0, 1, states[1]], [2, 3, 1, 0, states[0]], [4, 3, -1, 0, states[2]]]
        ]) {
            sim.seed(cells);
            sim.subject.step();
            assert.deepEqual(sim.occupied(), [[3, 3, 0, 1]]);
            assert.equal(sim.subject.grid[3][3][1].state, Math.max(...states));
        }
    }
});

test('cancelled vectors stay straight up; stationary arrivals contribute zero displacement', () => {
    const sim = simulation(0.5, 3);
    sim.seed([[2, 3, 1, 0, 2], [4, 3, -1, 0, 1]]);
    sim.noise(0.3);
    sim.subject.step();
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
    assert.equal(sim.subject.grid[3][3][1].state, 2);
    sim.seed([[2, 3, 1, 0, 2], [3, 3, 0, -1, 1]]);
    sim.noise(x => x < 0.125 ? 0 : 0.7);
    sim.subject.step();
    assert.deepEqual(sim.occupied(), [[3, 3, 1, 0]]);
    assert.equal(sim.subject.grid[3][3][1].state, 2);
});

test('corner initialization resets history, leaves surroundings empty, and tracks all occupied states', () => {
    for (const stateCount of [2, 3, 9]) {
        const sim = simulation(0.5, stateCount);
        for (let state = 1; state < stateCount; state++) {
            sim.phase((state + 0.5) / stateCount);
            sim.noise(0.6);
            sim.algorithm.history.set(27, [-1, -1]);
            sim.subject.initialize();
            assert.equal(sim.subject.grid[3][3][0].state, 0);
            assert.equal(sim.algorithm.history.has(27), false);
            assert.equal(sim.occupied().length, 16);
            assert.ok(sim.occupied().every(([x, y, dx, dy]) =>
                sim.subject.grid[x][y][0].state === state && dx === 1 && dy === 0));
        }
    }
});

test('state counts have matching palettes and invalid counts fail explicitly', () => {
    for (const stateCount of [2, 3, 9]) {
        assert.equal(simulation(0.5, stateCount).palette().length, stateCount);
    }
    for (const value of [0, 1, -1, 2.5, 10, NaN, Infinity, '3']) {
        assert.throws(() => simulation(0.5, value), /simulation.states must/);
    }
});

test('every occupied color survives forward, alternative, stationary, and wrapped movement', () => {
    for (const state of [1, 2, 8]) {
        const sim = simulation(0.5, 9);
        for (const [phase, x, y, expectedX, expectedY, dx, dy] of [
            [0, 3, 3, 4, 3, 1, 0], [0.51, 3, 3, 2, 2, -1, -1],
            [0.78, 3, 3, 3, 3, 0, 0], [0, 7, 3, 0, 3, 1, 0]
        ]) {
            sim.seed([[x, y, 1, 0, state]]);
            sim.phase(phase);
            sim.subject.step();
            assert.deepEqual(sim.occupied(), [[expectedX, expectedY, dx, dy]]);
            assert.equal(sim.subject.grid[expectedX][expectedY][1].state, state);
        }
    }
});

test('straight-up history continues at exactly the configured phase probability', () => {
    for (const probability of [0, 0.25, 0.5, 0.75, 1]) {
        const sim = simulation(probability, 3);
        sim.noise(0.375);
        let straight = 0;
        for (let index = 0; index < 64; index++) {
            sim.seed([[3, 3, 0, 0, 2]]);
            sim.phase((index + 0.5) / 64);
            sim.subject.step();
            const [x, y] = sim.occupied()[0];
            if (x === 3 && y === 3) {
                straight++;
                assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
                assert.equal(sim.subject.grid[3][3][1].state, 2);
            }
        }
        assert.equal(straight, 64 * probability);
    }
});

test('a lateral stay becomes a persistent straight-up line', () => {
    const sim = simulation(0.5, 3);
    sim.seed([[3, 3, 1, 0, 2]]);
    sim.phase(0.78);
    sim.subject.step();
    sim.phase(0);
    sim.subject.step();
    sim.subject.step();
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
    assert.ok(sim.subject.grid[3][3].slice(0, 4).every(cell => cell.state === 2));
});

test('straight-up can turn into each lateral direction, and Perlin initializes all nine directions', () => {
    const sim = simulation();
    const outcomes = sim.algorithm.ruleMap.get('move:0,0');
    assert.deepEqual(plain(outcomes[0]), { dx: 0, dy: 0, probability: 0.5 });
    for (let index = 1; index < outcomes.length; index++) {
        const move = outcomes[index];
        sim.seed([[3, 3, 0, 0]]);
        sim.phase(0.5 + (index - 0.5) / 16);
        sim.subject.step();
        assert.deepEqual(sim.occupied(), [[3 + move.dx, 3 + move.dy, move.dx, move.dy]]);
    }
    const directions = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1]];
    directions.forEach((direction, index) => {
        sim.noise((index + 0.5) / 9);
        assert.deepEqual(plain(sim.algorithm.perlinDirection(2, 3, 0)), direction);
    });
    sim.phase(0.75);
    sim.noise(0.5);
    sim.subject.initialize();
    assert.equal(sim.occupied().length, 16);
    assert.ok(sim.occupied().every(([, , dx, dy]) => dx === 0 && dy === 0));
    sim.phase(0);
    sim.noise(0);
    sim.subject.step();
    assert.equal(sim.occupied().length, 16);
    assert.ok(sim.occupied().every(([, , dx, dy]) => dx === 0 && dy === 0));
});

test('binary and multistate layers maintain valid states, nonincreasing occupancy, and row history', () => {
    for (const stateCount of [2, 3]) {
        const sim = simulation(0.73, stateCount, true);
        sim.seed([[0, 0, 1, 0, 1], [2, 2, -1, 1, stateCount - 1], [6, 6, 0, -1, stateCount - 1]]);
        sim.noise((x, y, z) => (x + y + z) % 1);
        let count = sim.occupied().length;
        for (let z = 1; z < 8; z++) {
            sim.phase(z / 8);
            sim.subject.step();
            assert.ok(sim.occupied().length <= count);
            count = sim.occupied().length;
            assert.ok(sim.subject.grid.every(column => column.every(layers =>
                Number.isInteger(layers[z].state) && layers[z].state >= 0 && layers[z].state < stateCount)));
            assert.deepEqual(Array.from(sim.subject.memory.getLatestRow()),
                plain(sim.subject.grid[0].map(layers => layers[z].state)));
        }
    }
});

function trajectorySimulation(parameters = {}, options = {}) {
    let phase = 0;
    const trajectory = {
        slope: [0.5, 0.5], bend: [0, 0], amplitude: [0, 0],
        wavelength: [8, 8], phase: [0, 0],
        parameterNoise: { spaceScale: 0.05, channels: 'separate' },
        ...parameters
    };
    const harness = createHarness({
        grid: { cols: 32, rows: 8, baseDepth: 32, ...options.grid },
        simulation: { algorithm: 'PN', states: 3 },
        initial: { mode: 'random' },
        memory: { enabled: options.memory ?? false },
        pn: { mode: 'trajectory', forwardProbability: options.probability ?? 1, trajectory, ...options.pn }
    }, {
        random: () => phase,
        noise: options.noise ?? ((x, y, z) => z === 0 ? 5.5 / 9 : 0.5)
    });
    const { subject } = harness;
    subject.initialize();
    for (const [x, y, state = 1] of options.cells ?? [[4, 3]]) {
        subject.grid[x][y][0].state = state;
    }
    subject.algorithm.initialize(subject.grid);
    return {
        ...harness,
        phase(value) { phase = value; },
        position() {
            assert.equal(subject.algorithm.trajectories.size, 1);
            const key = subject.algorithm.trajectories.keys().next().value;
            return [Math.floor(key / subject.settings.grid.rows), key % subject.settings.grid.rows];
        }
    };
}

test('trajectory slopes produce exact static, half, full, mirrored, and diagonal paths', () => {
    for (const [slope, direction, noise] of [
        [0, [1, 0], 5.5 / 9], [0.5, [1, 0], 5.5 / 9],
        [0.1, [1, 0], 5.5 / 9], [0.3, [1, 0], 5.5 / 9],
        [1, [1, 0], 5.5 / 9], [0.5, [-1, 0], 3.5 / 9],
        [0.5, [1, 1], 8.5 / 9], [0.5, [0, 0], 4.5 / 9]
    ]) {
        const sim = trajectorySimulation({ slope: [slope, slope] }, { noise: () => noise });
        for (let z = 0; z < 16; z++) {
            if (z > 0) sim.subject.step();
            assert.deepEqual(sim.position(), direction.map((value, axis) => {
                const size = axis === 0 ? 32 : 8;
                return (([4, 3][axis] + value * Math.floor(slope * z)) % size + size) % size;
            }));
            const path = sim.subject.algorithm.trajectories.values().next().value;
            assert.deepEqual(plain(path.direction), direction);
            assert.equal(sim.subject.grid[sim.position()[0]][sim.position()[1]][z].state, 1);
        }
    }
});

test('bending trajectories slow, pause, reverse, and keep their curve state', () => {
    const sim = trajectorySimulation({ slope: [0.375, 0.375], bend: [-0.03125, -0.03125] },
        { grid: { baseDepth: 20 } });
    const positions = [sim.position()[0]];
    for (let z = 1; z < 20; z++) {
        sim.subject.step();
        positions.push(sim.position()[0]);
        const displacement = 0.375 * z - 0.03125 * z * z / 2;
        assert.equal(positions[z], 4 + Math.trunc(displacement));
        assert.ok(Math.abs(positions[z] - positions[z - 1]) <= 1);
    }
    assert.ok(positions.some((x, z) => z > 0 && x > positions[z - 1]));
    assert.ok(positions.some((x, z) => z > 0 && x < positions[z - 1]));
    assert.equal(sim.subject.algorithm.trajectories.values().next().value.parameters.bend, -0.03125);
});

test('sine trajectories oscillate, cross their origin, and never skip adjacent cells', () => {
    const sim = trajectorySimulation({
        slope: [0, 0], amplitude: [2, 2], wavelength: [16, 16]
    });
    const positions = [4];
    for (let z = 1; z < 24; z++) {
        sim.subject.step();
        positions.push(sim.position()[0]);
        assert.ok(Math.abs(positions[z] - positions[z - 1]) <= 1);
    }
    assert.equal(positions[4], 6);
    assert.equal(positions[8], 4);
    assert.equal(positions[12], 2);
    assert.equal(positions[16], 4);
    assert.equal(positions[20], 6);
});

test('all trajectory ranges use stable separate or shared spatial Perlin channels', () => {
    const ranges = {
        slope: [0.1, 0.3], bend: [-0.001, 0.001], amplitude: [0, 0.2],
        wavelength: [16, 32], phase: [-Math.PI, Math.PI]
    };
    const names = Object.keys(ranges);
    for (const channels of ['separate', 'shared']) {
        const calls = [];
        const noise = (x, y, z) => {
            calls.push([x, y, z]);
            return z === 0 ? 5.5 / 9 : (x + y + z) / 10;
        };
        const sim = trajectorySimulation({
            ...ranges, parameterNoise: { spaceScale: 0.1, channels }
        }, { noise, cells: [[4, 3], [5, 3], [24, 3]] });
        const paths = sim.subject.algorithm.trajectories;
        for (const x of [4, 5, 24]) {
            const path = paths.get(x * 8 + 3);
            for (const [index, name] of names.entries()) {
                const [min, max] = ranges[name];
                const channel = channels === 'shared' ? 1 : index + 1;
                const u = (x * 0.1 + 0.3 + channel) / 10;
                assert.ok(Math.abs(path.parameters[name] - (min + u * (max - min))) < 1e-12);
            }
        }
        assert.ok(Math.abs(paths.get(4 * 8 + 3).parameters.slope -
            paths.get(5 * 8 + 3).parameters.slope) <
            Math.abs(paths.get(4 * 8 + 3).parameters.slope -
                paths.get(24 * 8 + 3).parameters.slope));
        assert.equal(calls.filter(([, , z]) => z > 0).length, 3 * (channels === 'shared' ? 1 : 5));
        const before = plain(Array.from(paths.values(), path => path.parameters));
        calls.length = 0;
        sim.subject.step();
        assert.deepEqual(plain(Array.from(sim.subject.algorithm.trajectories.values(), path => path.parameters)),
            before);
        assert.ok(calls.every(([x, y, z]) => z === 0 && x < 1 && y < 1),
            'later layers sample movement noise, not parameter fields');
        sim.subject.initialize();
        assert.equal(sim.subject.algorithm.trajectories.size, 0);
        sim.subject.grid[4][3][0].state = 1;
        calls.length = 0;
        sim.subject.algorithm.initialize(sim.subject.grid);
        assert.deepEqual(plain(sim.subject.algorithm.trajectories.get(4 * 8 + 3).parameters), before[0]);
        assert.equal(calls.filter(([, , z]) => z > 0).length, channels === 'shared' ? 1 : 5);
    }
});

test('trajectory parameter endpoints and invalid Perlin samples are handled explicitly', () => {
    for (const u of [0, 1]) {
        const sim = trajectorySimulation({ slope: [0, 0.5] }, {
            noise: (x, y, z) => z === 0 ? 5.5 / 9 : u
        });
        assert.equal(sim.subject.algorithm.trajectories.values().next().value.parameters.slope, 0.5 * u);
    }
    for (const value of [NaN, Infinity, -0.1, 1.1, '0.5']) {
        assert.throws(() => trajectorySimulation({}, {
            noise: (x, y, z) => z === 0 ? 5.5 / 9 : value
        }), /Invalid PN trajectory noise sample/);
        const sim = trajectorySimulation();
        sim.subject.algorithm.noise = () => value;
        assert.throws(() => sim.subject.step(), /Invalid PN trajectory noise sample/);
    }
    for (const value of [NaN, -0.1, 1, '0.5']) {
        const sim = trajectorySimulation();
        sim.phase(value);
        assert.throws(() => sim.subject.step(), /Invalid PN trajectory movement phase/);
    }
});

test('trajectory alternatives deviate locally without erasing half-slope progress', () => {
    const sim = trajectorySimulation({}, { probability: 0.5, noise: () => 5.5 / 9 });
    // Shift the shared phase so the preferred stationary move loses to [1, 0].
    sim.phase((0.5 + 4.5 / 16 - 5.5 / 9 + 1) % 1);
    sim.subject.step();
    assert.deepEqual(sim.position(), [5, 3]);
    assert.equal(sim.subject.algorithm.trajectories.values().next().value.offset[0], 0.5);
    sim.phase((1 - 5.5 / 9) % 1);
    sim.subject.step();
    assert.deepEqual(sim.position(), [6, 3]);
    assert.deepEqual(plain(sim.subject.algorithm.trajectories.values().next().value.direction), [1, 0]);

    const noForward = trajectorySimulation({}, { probability: 0, noise: () => 5.5 / 9 });
    noForward.phase((1 - 5.5 / 9) % 1);
    noForward.subject.step();
    assert.deepEqual(noForward.position(), [3, 2]);
});

test('trajectory wrapping preserves direction, sub-cell progress, colors, and row memory', () => {
    const sim = trajectorySimulation({}, { cells: [[31, 3, 2]], memory: true });
    for (let z = 1; z < 7; z++) {
        sim.subject.step();
        assert.deepEqual(sim.position(), [(31 + Math.floor(z / 2)) % 32, 3]);
        assert.equal(sim.subject.grid[sim.position()[0]][3][z].state, 2);
        assert.deepEqual(Array.from(sim.subject.memory.getLatestRow()),
            plain(sim.subject.grid[0].map(layers => layers[z].state)));
    }
    sim.subject.algorithm.trajectories.clear();
    assert.throws(() => sim.subject.step(), /Missing trajectory history/);
});

test('trajectory collisions average parameters and fractional directions, retain highest color, and rebase', () => {
    const sim = trajectorySimulation({ slope: [1, 1] },
        { cells: [[3, 3, 1], [4, 2, 2]] });
    const algorithm = sim.subject.algorithm;
    algorithm.trajectories.get(4 * 8 + 2).direction = [0, 1];
    sim.subject.step();
    assert.deepEqual(sim.position(), [4, 3]);
    assert.equal(sim.subject.grid[4][3][1].state, 2);
    assert.deepEqual(plain(algorithm.trajectories.values().next().value.direction), [0.5, 0.5]);
    assert.deepEqual(plain(algorithm.trajectories.values().next().value.offset), [0, 0]);
    sim.subject.step();
    assert.deepEqual(sim.position(), [4, 3]);
    sim.subject.step();
    assert.deepEqual(sim.position(), [5, 4]);

    const paths = [
        { direction: [1, 0], offset: [5.25, 0], parameters: {
            slope: 0.2, bend: -0.001, amplitude: 0.1, wavelength: 16, phase: Math.PI - 0.1
        } },
        { direction: [-1, 0], offset: [-3.5, 0], parameters: {
            slope: 0.6, bend: 0.001, amplitude: 0.3, wavelength: 32, phase: -Math.PI + 0.1
        } }
    ];
    const merged = algorithm.mergeTrajectories(paths, 8);
    assert.deepEqual(plain(merged.direction), [0, 0]);
    assert.deepEqual(plain(merged.offset), [-0.125, 0]);
    assert.equal(merged.parameters.slope, 0.4);
    assert.equal(merged.parameters.bend, 0);
    assert.equal(merged.parameters.amplitude, 0.2);
    assert.equal(merged.parameters.wavelength, 24);
    assert.ok(Math.abs(Math.abs(merged.parameters.phase) - Math.PI) < 1e-12);
    assert.deepEqual(plain(algorithm.mergeTrajectories([...paths].reverse(), 8)), plain(merged));
    paths[0].parameters.phase = 0;
    paths[1].parameters.phase = Math.PI;
    assert.equal(algorithm.mergeTrajectories(paths, 8).parameters.phase, 0);
});

test('spatially varied trajectories preserve valid layers and nonincreasing occupancy through collisions', () => {
    for (const states of [2, 3, 9]) {
        for (const probability of [0, 0.5, 1]) {
            const { subject } = createHarness({
                grid: { baseDepth: 12 }, simulation: { algorithm: 'PN', states },
                initial: { mode: 'random' }, view: { orientation: 'vertical' },
                pn: { mode: 'trajectory', forwardProbability: probability, trajectory: {
                    slope: [0, 0.5], bend: [-0.001, 0.001], amplitude: [0, 0.25],
                    wavelength: [16, 32], phase: [-Math.PI, Math.PI],
                    parameterNoise: { spaceScale: 0.2, channels: 'separate' }
                } }
            }, { random: seededRandom(), noise: (x, y, z) => (Math.sin(x * 5 + y * 3 + z * 2) + 1) / 2 });
            subject.initialize();
            let count = subject.algorithm.trajectories.size;
            for (let z = 1; z < subject.settings.depth; z++) {
                subject.step();
                const occupied = subject.grid.flatMap(column => column.map(layers => layers[z].state))
                    .filter(state => state !== 0);
                assert.equal(occupied.length, subject.algorithm.trajectories.size);
                assert.ok(occupied.length <= count);
                assert.ok(occupied.every(state => Number.isInteger(state) && state > 0 && state < states));
                assert.deepEqual(Array.from(subject.memory.getLatestRow()),
                    plain(subject.grid[0].map(layers => layers[z].state)));
                count = occupied.length;
            }
            assert.equal(subject.step(), null);
        }
    }
});

function assertTranslatedLayer(subject, initial, z, dx, dy) {
    const { cols, rows } = subject.settings.grid;
    for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
            const sourceX = ((x - dx) % cols + cols) % cols;
            const sourceY = ((y - dy) % rows + rows) % rows;
            assert.equal(subject.grid[x][y][z].state, initial[sourceX][sourceY]);
        }
    }
}

test('zero movement scales and probability one preserve collision-free legacy lines through wrapping', () => {
    for (const [sample, dx, dy] of [[3.5 / 9, -1, 0], [8.5 / 9, 1, 1], [4.5 / 9, 0, 0]]) {
        const calls = [];
        const { subject } = createHarness({
            grid: { cols: 5, rows: 4, baseDepth: 12 },
            simulation: { algorithm: 'PN', states: 3 }, initial: { mode: 'random' },
            memory: { enabled: false },
            pn: { mode: 'legacy', forwardProbability: 1, noiseSpaceScale: 0, noiseTimeScale: 0 }
        }, {
            random: seededRandom(),
            noise: (...coordinates) => { calls.push(coordinates); return sample; }
        });
        subject.initialize();
        const initial = subject.grid.map(column => column.map(layers => layers[0].state));
        const count = subject.algorithm.history.size;
        for (let z = 1; z < subject.settings.depth; z++) {
            subject.step();
            assertTranslatedLayer(subject, initial, z, dx * z, dy * z);
            assert.equal(subject.algorithm.history.size, count);
        }
        assert.ok(calls.length > 0 && calls.every(coordinates => coordinates.every(value => value === 0)));
    }
});

test('zero time scale freezes only the time coordinate while spatial sampling remains active', () => {
    const calls = [];
    const { subject } = createHarness({
        simulation: { algorithm: 'PN' }, initial: { mode: 'random' },
        pn: { mode: 'legacy', noiseSpaceScale: 0.1, noiseTimeScale: 0 }
    }, {
        random: seededRandom(),
        noise: (...coordinates) => { calls.push(coordinates); return 0.6; }
    });
    subject.initialize();
    calls.length = 0;
    subject.step();
    subject.step();
    assert.ok(calls.length > 0 && calls.every(([, , z]) => z === 0));
    assert.ok(calls.some(([x, y]) => x > 0 || y > 0));
});

test('zero parameter scale synchronizes curves without collisions for both channel settings', () => {
    for (const channels of ['separate', 'shared']) {
        const calls = [];
        const { subject } = createHarness({
            grid: { cols: 5, rows: 4, baseDepth: 40 },
            simulation: { algorithm: 'PN', states: 3 }, initial: { mode: 'random' },
            memory: { enabled: false },
            pn: {
                mode: 'trajectory', forwardProbability: 1, noiseSpaceScale: 0, noiseTimeScale: 0,
                trajectory: {
                    slope: [0, 0.25], bend: [-0.0001, 0.0001], amplitude: [0, 2],
                    wavelength: [32, 32], phase: [-0.5, 0.5],
                    parameterNoise: { spaceScale: 0, channels }
                }
            }
        }, {
            random: seededRandom(),
            noise: (x, y, z) => {
                calls.push([x, y, z]);
                return z === 0 ? 8.5 / 9 : (channels === 'shared' ? 0.5 : z / 10);
            }
        });
        subject.initialize();
        const initial = subject.grid.map(column => column.map(layers => layers[0].state));
        const count = subject.algorithm.trajectories.size;
        const parameters = subject.algorithm.trajectories.values().next().value.parameters;
        const normalizedSlope = parameters.slope / 0.25;
        const normalizedAmplitude = parameters.amplitude / 2;
        assert.equal(normalizedSlope, channels === 'shared' ? normalizedAmplitude : 0.1);
        if (channels === 'separate') assert.equal(normalizedAmplitude, 0.3);
        for (const path of subject.algorithm.trajectories.values()) {
            assert.deepEqual(plain(path.parameters), plain(parameters));
        }
        for (let z = 1; z < subject.settings.depth; z++) {
            subject.step();
            const { slope, bend, amplitude, wavelength, phase } = parameters;
            const displacement = Math.trunc(slope * z + bend * z * z / 2 +
                amplitude * (Math.sin(2 * Math.PI * z / wavelength + phase) - Math.sin(phase)));
            assertTranslatedLayer(subject, initial, z, displacement, displacement);
            assert.equal(subject.algorithm.trajectories.size, count);
        }
        assert.ok(calls.length > 0 && calls.every(([x, y]) => x === 0 && y === 0));
    }
});

test('varying trajectory parameters can still collide with zero movement scales and probability one', () => {
    const sim = trajectorySimulation({
        slope: [0, 1], parameterNoise: { spaceScale: 1, channels: 'shared' }
    }, {
        cells: [[0, 3, 1], [1, 3, 2]],
        pn: { noiseSpaceScale: 0, noiseTimeScale: 0 },
        noise: (x, y, z) => z === 0 ? 5.5 / 9 : (x === 0 ? 1 : 0)
    });
    assert.equal(sim.subject.algorithm.trajectories.size, 2);
    sim.subject.step();
    assert.deepEqual(sim.position(), [1, 3]);
    assert.equal(sim.subject.grid[1][3][1].state, 2);
});
