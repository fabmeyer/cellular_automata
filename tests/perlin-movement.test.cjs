const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness, plain } = require('./helpers.cjs');

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
