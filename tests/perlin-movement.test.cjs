const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../sketch_1d_3d.js'), 'utf8');

function simulation(probability = 0.5, stateCount = 2) {
    let phase = 0;
    let noiseValue = () => 0;
    const math = Object.create(Math);
    math.random = () => phase;
    const context = vm.createContext({
        Math: math,
        console: { log() {} },
        noise: (...args) => noiseValue(...args)
    });
    vm.runInContext(source
        .replace('const cols = 96;', 'const cols = 8;')
        .replace('const rows = 96;', 'const rows = 8;')
        .replace('const depth = 192 * 2;', 'const depth = 8;')
        .replace(/const pattern_size = \d+;/, 'const pattern_size = 2;')
        .replace(/const n_states = \d+;/, `const n_states = ${stateCount};`)
        .replace(/const forward_probability = [^;]+;/, `const forward_probability = ${probability};`), context);
    const run = code => vm.runInContext(code, context);
    const read = code => JSON.parse(JSON.stringify(run(code)));
    function seed(cells) {
        run(`
            movement_history.clear();
            time_step = 1;
            for (let x = 0; x < cols; x++) {
                for (let y = 0; y < rows; y++) {
                    grid[x][y][0] = new Cell(x * cell_size, y * cell_size, 0, 0);
                }
            }
        `);
        for (const [x, y, dx, dy, state = 1] of cells) {
            run(`grid[${x}][${y}][0].state = ${state};
                movement_history.set(${x} * rows + ${y}, [${dx}, ${dy}]);`);
        }
    }
    return {
        run, read, seed,
        phase(value) { phase = value; },
        noise(value) { noiseValue = typeof value === 'function' ? value : () => value; },
        occupied: () => read(`Array.from(movement_history, ([key, direction]) =>
            [Math.floor(key / rows), key % rows, ...direction]).sort((a, b) => a[0] - b[0] || a[1] - b[1])`)
    };
}

test('all direction maps have the configured probability intervals', () => {
    for (const probability of [0, 0.2, 0.5, 0.73, 1]) {
        const sim = simulation(probability);
        const rules = sim.read('Array.from(rule_map)');
        assert.equal(rules.length, 9);
        for (const [key, outcomes] of rules) {
            assert.equal(outcomes.length, 9);
            assert.equal(new Set(outcomes.map(o => `${o.dx},${o.dy}`)).size, 9);
            assert.equal(key, `move:${outcomes[0].dx},${outcomes[0].dy}`);
            assert.equal(outcomes[0].probability, probability);
            let lower = 0;
            for (const [index, outcome] of outcomes.entries()) {
                const width = index === 0 ? probability : (1 - probability) / 8;
                assert.equal(outcome.probability, width);
                if (width > 0) {
                    const selected = sim.read(`chooseMovement([${outcomes[0].dx},${outcomes[0].dy}], ${lower + width / 2})`);
                    assert.deepEqual(selected, outcome);
                }
                lower += width;
            }
            assert.ok(Math.abs(lower - 1) < 1e-14);
            assert.doesNotThrow(() => sim.run(`chooseMovement([${outcomes[0].dx},${outcomes[0].dy}], ${1 - Number.EPSILON})`));
        }
    }
});

test('invalid probability parameters fail explicitly', () => {
    for (const value of [-0.1, 1.1, 'NaN', 'Infinity', '"0.5"']) {
        assert.throws(() => simulation(value), /forward_probability must/);
    }
});

test('probability boundaries skip zero-weight outcomes and reject invalid samples', () => {
    const sim = simulation();
    assert.deepEqual(sim.read('chooseMovement([1, 0], 0)'), { dx: 1, dy: 0, probability: 0.5 });
    assert.deepEqual(sim.read('chooseMovement([1, 0], 0.5)'), { dx: -1, dy: -1, probability: 1 / 16 });
    assert.deepEqual(sim.read('chooseMovement([1, 0], 0.9375)'), { dx: 0, dy: 0, probability: 1 / 16 });
    for (const value of [-0.1, 1, 'NaN']) {
        assert.throws(() => sim.run(`chooseMovement([1, 0], ${value})`), /Invalid movement sample/);
    }
    const neverForward = simulation(0);
    assert.notEqual(neverForward.read('chooseMovement([1, 0], 0)').dx, 1);
    const alwaysForward = simulation(1);
    assert.deepEqual(alwaysForward.read(`chooseMovement([1, 0], ${1 - Number.EPSILON})`),
        { dx: 1, dy: 0, probability: 1 });
});

test('left-to-center-to-right motion retains its direction and has exactly half the phase interval', () => {
    const sim = simulation();
    sim.noise(0.375);
    let forward = 0;
    for (let index = 0; index < 32; index++) {
        sim.seed([[2, 3, 1, 0]]);
        sim.phase((index + 0.5) / 32);
        sim.run('updateState()');
        if (sim.occupied()[0][0] === 3 && sim.occupied()[0][1] === 3) {
            forward++;
        }
    }
    assert.equal(forward, 16);
    sim.seed([[1, 3, 1, 0]]);
    sim.phase(0);
    sim.noise(0);
    sim.run('updateState(); time_step++; updateState();');
    assert.deepEqual(sim.occupied(), [[3, 3, 1, 0]]);
});

test('empty cells have no agency and complete layers remain binary', () => {
    const sim = simulation();
    sim.seed([]);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), []);
    assert.equal(sim.run('grid.every(column => column.every(layers => layers[1] instanceof Cell && layers[1].state === 0))'), true);
});

test('staying sets straight-up direction and diagonal seam movement keeps signed displacement', () => {
    const sim = simulation();
    sim.seed([[3, 3, 1, 0]]);
    sim.phase(0.99);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
    sim.seed([[0, 7, -1, 1], [7, 0, 1, -1]]);
    sim.phase(0);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[0, 7, 1, -1], [7, 0, -1, 1]]);
});

test('collisions merge occupancy and combine all vectors before taking signs', () => {
    const sim = simulation(1);
    sim.seed([[2, 3, 1, 0], [3, 2, 0, 1], [4, 3, -1, 0]]);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 1]]);
    assert.equal(sim.run('grid.flatMap(column => column.map(layers => layers[1].state)).reduce((a, b) => a + b, 0)'), 1);
    sim.seed([[3, 2, 0, 1], [2, 3, 1, 0], [4, 3, -1, 0]]);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 1]]);
});

test('cancelled vectors stay straight up and staying contributes zero displacement', () => {
    const sim = simulation();
    sim.seed([[2, 3, 1, 0], [4, 3, -1, 0]]);
    sim.noise(0.3);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
    sim.seed([[2, 3, 1, 0], [3, 3, 0, -1]]);
    sim.noise(x => x < 0.25 ? 0 : 0.99);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[3, 3, 1, 0]]);
});

test('initial corner seed is binary, surroundings empty, and all occupied directions use Perlin', () => {
    const sim = simulation();
    sim.phase(0.75);
    sim.noise(0.5);
    sim.run('initializeGrid()');
    assert.equal(sim.run('grid[3][3][0].state'), 0);
    assert.equal(sim.occupied().length, 16);
    assert.equal(sim.occupied().every(cell => cell[2] === 1 && cell[3] === 0), true);
    sim.run('movement_history.set(27, [-1, -1]); initializeGrid();');
    assert.equal(sim.run('movement_history.has(27)'), false);
});

test('several layers preserve binary occupancy, nonincreasing counts, and row history compatibility', () => {
    const sim = simulation(0.73);
    sim.phase(0.75);
    sim.noise((x, y, z) => (x + y + z) % 1);
    sim.run('initializeGrid(); memory_cell_instance.addLayer(grid, 0);');
    let count = sim.occupied().length;
    for (let z = 1; z < 8; z++) {
        sim.phase(z / 8);
        sim.run(`time_step = ${z}; updateState(); memory_cell_instance.addLayer(grid, time_step);`);
        assert.ok(sim.occupied().length <= count);
        count = sim.occupied().length;
        assert.equal(sim.run(`grid.every(column => column.every(layers =>
            layers[${z}] instanceof Cell && [0, 1].includes(layers[${z}].state)))`), true);
    }
});

test('legacy count maps still use the existing count-based update path', () => {
    const sim = simulation();
    sim.seed([[2, 3, 1, 0]]);
    sim.run(`
        rule_map = new Map([['1,0', 0], ['0,1', 1]]);
        updateState();
    `);
    assert.equal(sim.run('grid[2][3][1].state'), 1);
    assert.equal(sim.run('grid[3][3][1].state'), 0);
});

test('supported state counts have matching palettes and invalid counts fail explicitly', () => {
    for (const stateCount of [2, 3, 9]) {
        const sim = simulation(0.5, stateCount);
        assert.equal(sim.run('colors.length'), stateCount);
    }
    for (const stateCount of [0, 1, -1, 2.5, 10, 'NaN', 'Infinity', '"3"']) {
        assert.throws(() => simulation(0.5, stateCount), /n_states must be an integer between 2 and 9/);
    }
});

test('all occupied states retain color during forward, alternative, stationary, and wrapped movement', () => {
    for (const state of [1, 2, 8]) {
        const sim = simulation(0.5, 9);
        for (const [phase, x, y, expectedX, expectedY, dx, dy] of [
            [0, 3, 3, 4, 3, 1, 0],
            [0.51, 3, 3, 2, 2, -1, -1],
            [0.99, 3, 3, 3, 3, 0, 0],
            [0, 7, 3, 0, 3, 1, 0]
        ]) {
            sim.seed([[x, y, 1, 0, state]]);
            sim.phase(phase);
            sim.run('updateState()');
            assert.deepEqual(sim.occupied(), [[expectedX, expectedY, dx, dy]]);
            assert.equal(sim.run(`grid[${expectedX}][${expectedY}][1].state`), state);
        }
    }
});

test('mixed-state collisions retain the maximum state and sum every incoming direction', () => {
    for (const states of [[2, 1, 1], [1, 1, 2], [2, 2, 2]]) {
        const sim = simulation(1, 3);
        sim.seed([[2, 3, 1, 0, states[0]], [3, 2, 0, 1, states[1]], [4, 3, -1, 0, states[2]]]);
        sim.run('updateState()');
        assert.deepEqual(sim.occupied(), [[3, 3, 0, 1]]);
        assert.equal(sim.run('grid[3][3][1].state'), 2);
    }
});

test('highest state survives cancellation and a stationary arrival adds zero displacement', () => {
    const sim = simulation(0.5, 3);
    sim.seed([[2, 3, 1, 0, 2], [4, 3, -1, 0, 1]]);
    sim.noise(0.3);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
    assert.equal(sim.run('grid[3][3][1].state'), 2);
    sim.seed([[2, 3, 1, 0, 2], [3, 3, 0, -1, 1]]);
    sim.noise(x => x < 0.25 ? 0 : 0.99);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[3, 3, 1, 0]]);
    assert.equal(sim.run('grid[3][3][1].state'), 2);
});

test('initialization tracks each occupied state, resets history, and leaves surroundings empty', () => {
    const sim = simulation(0.5, 3);
    for (const [phase, state] of [[0.4, 1], [0.8, 2]]) {
        sim.phase(phase);
        sim.noise(0.5);
        sim.run('movement_history.set(27, [-1, -1]); initializeGrid();');
        assert.equal(sim.run('grid[3][3][0].state'), 0);
        assert.equal(sim.run('movement_history.has(27)'), false);
        assert.equal(sim.occupied().length, 16);
        assert.ok(sim.occupied().every(([x, y, dx, dy]) =>
            sim.run(`grid[${x}][${y}][0].state`) === state && dx === 1 && dy === 0));
    }
});

test('straight-up history continues at the configured probability', () => {
    for (const probability of [0, 0.25, 0.5, 0.75, 1]) {
        const sim = simulation(probability, 3);
        sim.noise(0.375);
        let straight = 0;
        for (let index = 0; index < 64; index++) {
            sim.seed([[3, 3, 0, 0, 2]]);
            sim.phase((index + 0.5) / 64);
            sim.run('updateState()');
            const [x, y] = sim.occupied()[0];
            if (x === 3 && y === 3) {
                straight++;
                assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
                assert.equal(sim.run('grid[3][3][1].state'), 2);
            }
        }
        assert.equal(straight, 64 * probability);
    }
});

test('a lateral stay becomes a persistent straight-up line in successive layers', () => {
    const sim = simulation(0.5, 3);
    sim.seed([[3, 3, 1, 0, 2]]);
    sim.phase(0.99);
    sim.run('updateState()');
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
    sim.phase(0);
    sim.run('time_step++; updateState(); time_step++; updateState();');
    assert.deepEqual(sim.occupied(), [[3, 3, 0, 0]]);
    assert.equal(sim.run('grid[3][3].slice(0, 4).every(cell => cell.state === 2)'), true);
});

test('straight-up direction can turn into each of the eight lateral directions', () => {
    const sim = simulation();
    const outcomes = sim.read('rule_map.get("move:0,0")');
    assert.deepEqual(outcomes[0], { dx: 0, dy: 0, probability: 0.5 });
    for (let index = 1; index < outcomes.length; index++) {
        const move = outcomes[index];
        sim.seed([[3, 3, 0, 0]]);
        sim.phase(0.5 + (index - 0.5) / 16);
        sim.run('updateState()');
        assert.deepEqual(sim.occupied(), [[3 + move.dx, 3 + move.dy, move.dx, move.dy]]);
    }
});

test('Perlin initialization includes every direction including straight up', () => {
    const sim = simulation();
    const directions = sim.read('movement_directions');
    assert.equal(directions.length, 9);
    directions.forEach((direction, index) => {
        sim.noise((index + 0.5) / 9);
        assert.deepEqual(sim.read('perlinDirection(2, 3, 0)'), direction);
    });
    sim.phase(0.75);
    sim.noise(0.95);
    sim.run('initializeGrid()');
    assert.equal(sim.occupied().length, 16);
    assert.ok(sim.occupied().every(([, , dx, dy]) => dx === 0 && dy === 0));
    sim.phase(0);
    sim.noise(0);
    sim.run('time_step = 1; updateState()');
    assert.equal(sim.occupied().length, 16);
    assert.ok(sim.occupied().every(([, , dx, dy]) => dx === 0 && dy === 0));
});

test('multistate layers maintain valid states, nonincreasing occupancy, and compatible row history', () => {
    const sim = simulation(0.73, 3);
    sim.seed([[0, 0, 1, 0, 1], [2, 2, -1, 1, 2], [6, 6, 0, -1, 2]]);
    sim.noise((x, y, z) => (x + y + z) % 1);
    let count = sim.occupied().length;
    for (let z = 1; z < 8; z++) {
        sim.phase(z / 8);
        sim.run(`time_step = ${z}; updateState(); memory_cell_instance.addLayer(grid, time_step);`);
        assert.ok(sim.occupied().length <= count);
        count = sim.occupied().length;
        assert.equal(sim.run(`grid.every(column => column.every(layers =>
            layers[${z}] instanceof Cell && [0, 1, 2].includes(layers[${z}].state)))`), true);
        assert.deepEqual(sim.read('Array.from(memory_cell_instance.getLatestRow())'),
            sim.read(`grid[0].map(layers => layers[${z}].state)`));
    }
});
