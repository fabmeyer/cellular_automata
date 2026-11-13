const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness, seededRandom, drawingStub, plain } = require('./helpers.cjs');

const initializers = [
    { mode: 'random' },
    ...['plain', 'D4'].flatMap(symmetry =>
        [{ placement: 'tiled' }, { placement: 'center' },
            ...[false, true].map(loopPattern => ({ placement: 'corners', loopPattern }))]
            .map(options => ({ mode: 'seed', symmetry, ...options })))
];
const algorithms = [
    { algorithm: 'PN' },
    ...['counts', 'sum', 'majority'].flatMap(rule =>
        [false, true].map(cycle => ({ algorithm: 'CA', rule, cycle })))
];

test('CA and PN render the requested palette for empty and occupied states', () => {
    for (const [algorithm, expected] of [
        ['CA', ['rgba(0, 0, 0, 0.5)', 'rgb(0, 127, 254)', 'rgb(25, 51, 76)']],
        ['PN', ['rgba(0, 0, 0, 0.05)', 'rgba(0, 127, 254, 0.95)', 'rgba(25, 51, 76, 0.95)']]
    ]) {
        const { subject, classes } = createHarness({
            grid: { cols: 3, rows: 1 }, simulation: { algorithm, states: 3 },
            initial: { mode: 'random' }, ca: { neighborhoodSize: 1 }
        });
        const samples = [0, 0.5, 0.999, 0.1, 0.2, 0.3];
        let draws = 0;
        const { drawing, calls } = drawingStub();
        const renderer = new classes.GridRenderer(subject.settings, drawing, () => samples[draws++]);
        assert.deepEqual(plain(renderer.colors), expected, algorithm);
        assert.equal(draws, 6, algorithm);
        subject.initialize();
        for (let x = 0; x < 3; x++) {
            subject.grid[x][0][0].state = x;
        }
        renderer.drawLayer(subject.grid, 0);
        assert.deepEqual(calls.filter(([name]) => name === 'fill').map(([, color]) => color),
            expected, algorithm);
    }
});

test('all 756 algorithm/rule/cycling, initializer, view, memory, and state-count combinations run and render', () => {
    let combinations = 0;
    for (const algorithm of algorithms) {
        for (const initial of initializers) {
            for (const orientation of ['sideways', 'vertical']) {
                for (const enabled of [false, true]) {
                    for (const states of [2, 3, 9]) {
                        const label = JSON.stringify({ algorithm, initial, orientation, enabled, states });
                        const { subject, classes } = createHarness({
                            grid: { cols: 6, rows: 5, baseDepth: 2 },
                            simulation: { algorithm: algorithm.algorithm, states },
                            ca: { rule: algorithm.rule, neighborhoodSize: 3,
                                cycleUniform: algorithm.cycle },
                            initial, view: { orientation }, memory: { enabled }
                        }, { random: seededRandom(), noise: (x, y, z) => (x + y + z) % 1 });
                        const { drawing, calls } = drawingStub();
                        const renderer = new classes.GridRenderer(subject.settings, drawing, seededRandom());
                        renderer.setup();
                        subject.initialize();
                        renderer.drawLayer(subject.grid, 0);
                        const depth = orientation === 'vertical' ? 4 : 2;
                        assert.equal(subject.settings.depth, depth, label);
                        assert.equal(subject.memory !== null, enabled, label);
                        let count = subject.algorithm.history?.size;
                        for (let z = 1; z < depth; z++) {
                            assert.equal(subject.step(), z, label);
                            renderer.drawLayer(subject.grid, z);
                            if (algorithm.algorithm === 'PN') {
                                assert.ok(subject.algorithm.history.size <= count, label);
                                count = subject.algorithm.history.size;
                            }
                        }
                        assert.equal(subject.step(), null, label);
                        assert.equal(subject.step(), null, label);
                        assert.ok(subject.grid.every(column => column.every(layers =>
                            layers.every(cell => cell && Number.isInteger(cell.state) &&
                                cell.state >= 0 && cell.state < states))), label);
                        assert.equal(calls.filter(([name]) => name === 'box').length, 6 * 5 * depth, label);
                        assert.ok(calls.filter(([name]) => name === 'fill').every(([, color]) =>
                            typeof color === 'string'), label);
                        assert.deepEqual(calls.filter(([name]) => name.startsWith('rotate')).slice(0, 3)
                            .map(([, angle]) => angle),
                        subject.settings.preset.rotation.map(value => value * Math.PI), label);
                        combinations++;
                    }
                }
            }
        }
    }
    assert.equal(combinations, 756);
});

test('memory and view changes do not alter the shared generations for any algorithm or initializer', () => {
    for (const algorithm of algorithms) {
        for (const initial of initializers) {
            let baseline;
            for (const orientation of ['sideways', 'vertical']) {
                for (const enabled of [false, true]) {
                    const { subject } = createHarness({
                        grid: { baseDepth: 36 },
                        simulation: { algorithm: algorithm.algorithm, states: 3 },
                        ca: { rule: algorithm.rule, neighborhoodSize: 3,
                            cycleUniform: algorithm.cycle },
                        initial, view: { orientation }, memory: { enabled }
                    }, { random: seededRandom(), noise: (x, y, z) => (x + y + z) % 1 });
                    subject.initialize();
                    for (let z = 1; z < 8; z++) {
                        subject.step();
                    }
                    const generations = plain(subject.grid.map(column => column.map(layers =>
                        layers.slice(0, 8).map(cell => cell.state))));
                    if (baseline) {
                        assert.deepEqual(generations, baseline);
                    } else {
                        baseline = generations;
                    }
                }
            }
        }
    }
});

test('initializers tile and stamp non-looping corners on rectangular grids with empty surroundings', () => {
    for (const initial of initializers.filter(options => options.placement !== 'center' && !options.loopPattern)) {
        const { subject } = createHarness({
            grid: { cols: 6, rows: 5 }, initial, simulation: { states: 2 }
        }, { random: () => 0.75 });
        subject.initialize();
        const occupied = subject.grid.flatMap(column => column.map(layers => layers[0].state))
            .filter(state => state !== 0).length;
        const expected = initial.mode === 'random' || initial.placement === 'tiled' ? 30 : 16;
        assert.equal(occupied, expected, JSON.stringify(initial));
        if (initial.placement === 'corners') {
            assert.equal(subject.grid[0][0][0].state, 1);
            assert.equal(subject.grid[5][4][0].state, 1);
            assert.equal(subject.grid[2][2][0].state, 0);
        }
    }
});

test('center always loops and looping corners repeat the placed seed seamlessly', () => {
    for (const symmetry of ['plain', 'D4']) {
        for (const placement of ['center', 'corners']) {
            for (const [cols, rows, patternSize] of [[11, 7, 3], [9, 9, 4]]) {
                // Center ignores loopPattern, so false must still loop.
                const loopPattern = placement === 'corners';
                const { subject } = createHarness({
                    grid: { cols, rows }, simulation: { states: 9 },
                    initial: { mode: 'seed', symmetry, placement, patternSize, loopPattern }
                }, { random: seededRandom(7) });
                subject.initialize();
                const state = (x, y) => subject.grid[x][y][0].state;
                const [originX, originY] = placement === 'center'
                    ? [Math.floor((cols - patternSize) / 2), Math.floor((rows - patternSize) / 2)] : [0, 0];
                const label = JSON.stringify({ symmetry, placement, cols, rows, patternSize });
                for (let x = 0; x < cols; x++) {
                    for (let y = 0; y < rows; y++) {
                        const insideCorner = placement === 'corners' &&
                            (x < patternSize || x >= cols - patternSize) && (y < patternSize || y >= rows - patternSize);
                        if (insideCorner) {
                            continue;
                        }
                        const tileX = originX + ((x - originX) % patternSize + patternSize) % patternSize;
                        const tileY = originY + ((y - originY) % patternSize + patternSize) % patternSize;
                        assert.equal(state(x, y), state(tileX, tileY), `${label} at ${x},${y}`);
                    }
                }
            }
        }
    }
});

test('D4 seeds preserve every rotation/reflection and tiled repetition, including partial edge tiles', () => {
    const { subject } = createHarness({
        grid: { cols: 8, rows: 7 },
        initial: { symmetry: 'D4', placement: 'tiled', patternSize: 3 }
    }, { random: seededRandom() });
    subject.initialize();
    const state = (x, y) => subject.grid[x][y][0].state;
    for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 7; y++) {
            assert.equal(state(x, y), state(x % 3, y % 3));
        }
    }
    for (let x = 0; x < 3; x++) {
        for (let y = 0; y < 3; y++) {
            for (const [i, j] of [[x, y], [y, 2 - x], [2 - x, 2 - y], [2 - y, x],
                [x, 2 - y], [2 - x, y], [y, x], [2 - y, 2 - x]]) {
                assert.equal(state(x, y), state(i, j));
            }
        }
    }
});

test('overlapping corner seeds have deterministic last-stamp-wins behavior', () => {
    let value = 0;
    const { subject } = createHarness({
        grid: { cols: 3, rows: 3 },
        simulation: { states: 4 },
        initial: { patternSize: 2, symmetry: 'plain', placement: 'corners' }
    }, { random: () => value++ / 4 });
    subject.initialize();
    assert.deepEqual(plain(subject.grid.map(column => column.map(layers => layers[0].state))),
        [[0, 0, 1], [0, 0, 1], [2, 2, 3]]);
});

test('majority handles unique winners, both tie cases, and uniform cycling for every state', () => {
    const { subject } = createHarness({
        simulation: { algorithm: 'CA', states: 4 },
        ca: { rule: 'majority', neighborhoodSize: 3, cycleUniform: true }
    });
    const ca = subject.algorithm;
    assert.equal(ca.resolveState([1, 5, 2, 1], 0), 1);
    assert.equal(ca.resolveState([4, 4, 1, 0], 1), 1);
    assert.equal(ca.resolveState([1, 4, 4, 0], 0), 0);
    for (let state = 0; state < 4; state++) {
        const counts = [0, 0, 0, 0];
        counts[state] = 9;
        assert.equal(ca.resolveState(counts, state), (state + 1) % 4);
    }
    subject.settings.ca.cycleUniform = false;
    assert.equal(ca.resolveState([0, 0, 9, 0], 2), 2);
});

test('count rules cache histograms, sum rules share equal sums, and neither redraws an existing rule', () => {
    for (const rule of ['counts', 'sum']) {
        const draws = [0.8, 0.1, 0.9, 0.9];
        let calls = 0;
        const { subject } = createHarness({
            simulation: { algorithm: 'CA', states: 3 },
            ca: { rule, neighborhoodSize: 3, emptyStateProbability: 0.75 }
        }, { random: () => draws[calls++] });
        const ca = subject.algorithm;
        assert.equal(ca.resolveState([4, 4, 1], 0), 1);
        assert.equal(ca.resolveState([4, 4, 1], 2), 1);
        assert.equal(calls, 2);
        assert.equal(ca.resolveState([5, 2, 2], 0), rule === 'counts' ? 2 : 1);
        assert.equal(calls, rule === 'counts' ? 4 : 2);
        assert.equal(ca.ruleMap.size, rule === 'counts' ? 2 : 1);
    }
});

test('random CA uses the shared empty probability and uniform overrides take priority for both rules', () => {
    for (const rule of ['counts', 'sum']) {
        for (const emptyStateProbability of [0, 1]) {
            const { subject } = createHarness({
                simulation: { algorithm: 'CA', states: 3 },
                ca: { rule, neighborhoodSize: 3, emptyStateProbability }
            }, { random: () => 0.99 });
            const ca = subject.algorithm;
            assert.equal(ca.resolveState([3, 3, 3], 0), emptyStateProbability === 1 ? 0 : 2);
            subject.settings.ca.cycleUniform = true;
            assert.equal(ca.resolveState([9, 0, 0], 0), 1);
            assert.equal(ca.resolveState([0, 0, 9], 2), 0);
        }
    }
});

test('large wrapped neighborhoods work on tiny grids and do not precompute the count-rule universe', () => {
    for (const rule of ['counts', 'sum', 'majority']) {
        const { subject, classes } = createHarness({
            grid: { cols: 2, rows: 1, baseDepth: 2 },
            simulation: { algorithm: 'CA', states: 9 },
            initial: { mode: 'random' },
            ca: { rule, neighborhoodSize: 9 }
        });
        assert.equal(subject.algorithm.ruleMap.size, 0);
        subject.initialize();
        assert.equal(subject.step(), 1);
        assert.ok(subject.algorithm.ruleMap.size <= 2);
        assert.equal(classes.wrapIndex(-17, 2), 1);
    }
});

test('CA neighborhoods include the center, wrap both axes, and read only the previous generation', () => {
    const { subject } = createHarness({
        grid: { cols: 3, rows: 3, baseDepth: 2 },
        simulation: { algorithm: 'CA', states: 3 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 3 }
    });
    subject.initialize();
    const observed = [];
    subject.algorithm.resolveState = (counts, current) => {
        observed.push([Array.from(counts), current]);
        return 2;
    };
    subject.grid[0][0][0].state = 1;
    subject.step();
    assert.equal(observed.length, 9);
    assert.ok(observed.every(([counts]) => counts[0] === 8 && counts[1] === 1 && counts[2] === 0));
    assert.equal(observed[0][1], 1);
    assert.equal(observed[1][1], 0);
});

test('memory reports when a uniform CA cycle has no eligible rule to change', () => {
    const { subject, logs } = createHarness({
        grid: { cols: 3, rows: 2, baseDepth: 128 },
        simulation: { algorithm: 'CA', states: 8 },
        initial: { mode: 'random' },
        ca: { rule: 'sum', neighborhoodSize: 3, cycleUniform: true },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 1 }
    });
    subject.initialize();
    for (let z = 1; z <= 39; z++) {
        subject.step();
    }
    assert.ok(logs.some(([message]) => message.includes('period=8')));
    assert.equal(subject.algorithm.ruleMap.size, 0);
    assert.ok(!logs.some(([message]) => message.includes('Memory changed CA rule')));
    assert.ok(logs.some(([message]) => message.includes('no non-uniform CA rule')));
});

test('memory changes an active non-uniform interior rule when the repeated side uses uniform cycling', () => {
    const { subject, logs } = createHarness({
        grid: { cols: 9, rows: 1, baseDepth: 8 },
        simulation: { algorithm: 'CA', states: 2 },
        initial: { mode: 'random' },
        ca: { rule: 'sum', neighborhoodSize: 3, cycleUniform: true, emptyStateProbability: 1 },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 0.25 }
    });
    subject.initialize();
    subject.grid[4][0][0].state = 1;
    subject.step();
    subject.step();
    assert.equal(subject.algorithm.lastLayerRuleKeys[0][0], null);
    assert.ok(subject.algorithm.lastLayerRuleKeys.flat().some(key => key !== null));
    assert.ok(logs.some(([message]) => message.includes('period=2')));
    assert.ok(logs.some(([message]) => message.includes('Memory changed CA rule')));
    assert.equal(subject.algorithm.resolveState([9, 0], 0), 1);
});

test('memory retries when a uniform cycle later has an eligible interior rule', () => {
    const { subject, logs } = createHarness({
        grid: { cols: 9, rows: 1, baseDepth: 8 },
        simulation: { algorithm: 'CA', states: 2 },
        initial: { mode: 'random' },
        ca: { rule: 'sum', neighborhoodSize: 3, cycleUniform: true, emptyStateProbability: 1 },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 0.25 }
    });
    subject.initialize();
    subject.step();
    subject.step();
    assert.ok(logs.some(([message]) => message.includes('no non-uniform CA rule')));
    assert.ok(!logs.some(([message]) => message.includes('Memory changed CA rule')));

    subject.grid[4][0][2].state = 1;
    subject.step();
    assert.ok(logs.some(([message]) => message.includes('Memory changed CA rule')));
    assert.equal(subject.memory.items.length, 1);
    assert.equal(subject.algorithm.resolveState([9, 0], 0), 1);
});

test('memory detects a three-generation cycle without repeated spatial stripes', () => {
    const { subject, logs } = createHarness({
        grid: { cols: 3, rows: 2, baseDepth: 7 },
        simulation: { algorithm: 'CA', states: 3 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: true },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 1 / 3 }
    });
    subject.initialize();
    for (let x = 0; x < 3; x++) {
        for (let y = 0; y < 2; y++) {
            subject.grid[x][y][0].state = x;
        }
    }
    for (let z = 1; z <= 5; z++) {
        subject.step();
    }
    assert.deepEqual(subject.grid.map(column => column.map(layers => layers[3].state)),
        subject.grid.map(column => column.map(layers => layers[0].state)));
    assert.ok(logs.some(([message]) => message.includes('period=3')));
});

test('default memory threshold detects a three-generation cycle after 36 matching generations', () => {
    const { subject, logs } = createHarness({
        grid: { cols: 1, rows: 1, baseDepth: 192 },
        simulation: { algorithm: 'CA', states: 3 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: true },
        memory: { enabled: true, capacityMultiplier: 4, matchRunFraction: 1 }
    });
    subject.initialize();
    for (let z = 1; z < 38; z++) {
        subject.step();
    }
    assert.equal(logs.length, 0);
    subject.step();
    assert.ok(logs.some(([message]) => message.includes('z=38') && message.includes('period=3')));
});

test('memory detects two matching quarter-depth sequences beyond its state-based capacity', () => {
    const { subject, logs } = createHarness({
        grid: { cols: 1, rows: 6, baseDepth: 192 },
        simulation: { algorithm: 'CA', states: 2 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: false },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 1 }
    });
    subject.initialize();
    assert.equal(subject.memory.capacity, 48);
    assert.equal(subject.memory.matchRunLength, 4);
    subject.algorithm.lastLayerRuleKeys = [Array(6).fill(null)];
    subject.algorithm.step = (grid, z) => {
        for (let y = 0; y < 6; y++) {
            grid[0][y][z] = { state: ((z % 48) >> y) & 1 };
        }
    };
    for (let z = 1; z < 96; z++) {
        subject.step();
    }
    assert.ok(logs.some(([message]) => message.includes('period=48')));
});

test('periods up to a quarter depth are detected even if the configured run length is larger', () => {
    for (const period of [15, 16]) {
        const { subject, logs } = createHarness({
            grid: { cols: 1, rows: 4, baseDepth: 64 },
            simulation: { algorithm: 'CA', states: 2 },
            initial: { mode: 'random' },
            ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: false },
            memory: { enabled: true, capacityMultiplier: 20, matchRunFraction: 1 }
        });
        subject.initialize();
        subject.algorithm.lastLayerRuleKeys = [Array(4).fill(null)];
        subject.algorithm.step = (grid, z) => {
            for (let y = 0; y < 4; y++) {
                grid[0][y][z] = { state: ((z % period) >> y) & 1 };
            }
        };
        for (let z = 1; z < period + 15; z++) {
            subject.step();
        }
        assert.equal(logs.length, 0);
        subject.step();
        assert.ok(logs.some(([message]) => message.includes(`period=${period}`)));
    }
});

test('quarter-depth history uses effective depth in both view orientations', () => {
    for (const [orientation, capacity] of [['sideways', 47], ['vertical', 95]]) {
        const { subject } = createHarness({
            grid: { baseDepth: 191 },
            simulation: { algorithm: 'CA', states: 2 },
            ca: { rule: 'majority', neighborhoodSize: 1 },
            initial: { mode: 'random' },
            memory: { enabled: true, capacityMultiplier: 1 },
            view: { orientation }
        });
        assert.equal(subject.settings.memoryCapacity, capacity);
    }
});

test('a later longer cycle is reported after an earlier short cycle', () => {
    const { subject, logs } = createHarness({
        grid: { cols: 1, rows: 5, baseDepth: 64 },
        simulation: { algorithm: 'CA', states: 2 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: false },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 1 }
    });
    subject.initialize();
    subject.algorithm.lastLayerRuleKeys = [Array(5).fill(null)];
    subject.algorithm.step = (grid, z) => {
        const value = z < 5 ? 0 : ((z - 5) % 16) + 1;
        for (let y = 0; y < 5; y++) {
            grid[0][y][z] = { state: (value >> y) & 1 };
        }
    };
    for (let z = 1; z < 37; z++) {
        subject.step();
    }
    assert.ok(logs.some(([message]) => message.includes('period=1')));
    assert.ok(logs.some(([message]) => message.includes('period=16')));
});

test('memory measures a fresh repetition after every successful rule change', () => {
    for (const multiplier of [1, 2]) {
        const { subject, logs } = createHarness({
            simulation: { algorithm: 'CA', states: 2 },
            grid: { cols: 1, rows: 1, baseDepth: 64 },
            initial: { mode: 'random' },
            ca: { rule: 'counts', neighborhoodSize: 1, cycleUniform: false },
            memory: { enabled: true, capacityMultiplier: multiplier, matchRunFraction: 0.75 }
        });
        subject.initialize();
        subject.algorithm.ruleMap.set('1,0', 0);
        subject.algorithm.ruleMap.set('0,1', 1);
        const threshold = 3 * multiplier;
        const changes = () => logs.filter(([message]) => message.startsWith('Memory changed CA rule'));
        const notices = () => logs.filter(([message]) => message.includes('repetition threshold reached'));

        for (let z = 1; z <= threshold; z++) subject.step();
        assert.equal(changes().length, 1);
        for (let z = 1; z <= threshold; z++) subject.step();
        assert.equal(changes().length, 1, 'a new repetition must reach its full threshold');
        subject.step();
        assert.equal(changes().length, 2);
        assert.equal(notices().length, 2);
        assert.ok(notices().every(([message]) => message.includes('period=1')));
        assert.equal(subject.algorithm.ruleMap.get('0,1'), 0);
        for (let z = 1; z <= threshold; z++) subject.step();
        assert.equal(changes().length, 2);
        subject.step();
        assert.equal(changes().length, 3);
        assert.equal(notices().length, 3);
        assert.ok(notices()[2][0].includes('period=2'));
    }
});

test('memory logs and changes one CA rule after a repeated side-stripe run', () => {
    const { subject, logs } = createHarness({
        simulation: { algorithm: 'CA', states: 2 },
        grid: { cols: 2, rows: 1, baseDepth: 16 },
        initial: { mode: 'random' },
        ca: { rule: 'counts', neighborhoodSize: 1, cycleUniform: false },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 0.75 }
    });
    subject.initialize();
    const memory = subject.memory;
    assert.equal(memory.capacity, 4);
    assert.equal(memory.matchRunLength, 3);
    subject.algorithm.ruleMap.set('1,0', 0);
    subject.algorithm.ruleMap.set('0,1', 1);

    subject.step();
    subject.step();
    assert.equal(logs.length, 0);
    subject.step();

    assert.notEqual(subject.memory, memory);
    assert.equal(subject.memory.items.length, 1);
    assert.deepEqual(Array.from(subject.memory.getLatestRow()), [0]);
    assert.equal(subject.algorithm.ruleMap.get('1,0'), 1);
    assert.equal(subject.algorithm.ruleMap.get('0,1'), 1);
    assert.equal(subject.algorithm.ruleMap.size, 2);
    assert.ok(logs.some(([message]) => message === 'Memory changed CA rule 1,0: 0 -> 1'));

    subject.step();
    assert.equal(subject.algorithm.ruleMap.get('1,0'), 1);
    assert.equal(logs.filter(([message]) => message.startsWith('Memory changed CA rule')).length, 1);

    subject.initialize();
    assert.notEqual(subject.memory, memory);
    assert.equal(subject.memory.items.length, 1);
    assert.equal(subject.algorithm.ruleMap.size, 0);
});

test('memory requires consecutive matches with the same period', () => {
    const { subject, classes } = createHarness({
        grid: { cols: 1, rows: 1, baseDepth: 5 },
        simulation: { algorithm: 'CA', states: 3 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: false },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 2 / 9 }
    });
    const memory = new classes.RowMemory(subject.settings);
    const grid = [[[0, 1, 0, 2, 0].map(state => ({ state }))]];
    for (let z = 0; z < 5; z++) {
        assert.equal(memory.addLayer(grid, z), false);
    }
});

test('memory compares the oldest retained generation before overwriting it', () => {
    const { subject, classes } = createHarness({
        grid: { cols: 1, rows: 3, baseDepth: 6 },
        simulation: { algorithm: 'CA', states: 2 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: false },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 0.25 }
    });
    const memory = new classes.RowMemory(subject.settings);
    const stripes = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0]];
    const grid = [Array.from({ length: 3 }, (_, y) => stripes.map(stripe => ({ state: stripe[y] })))];
    for (let z = 0; z < 4; z++) {
        assert.equal(memory.addLayer(grid, z), false);
    }
    assert.equal(memory.addLayer(grid, 4), true);
    assert.equal(memory.latestPeriod, 4);
    assert.equal(memory.items.length, 4);
    assert.deepEqual(Array.from(memory.getLatestRow()), stripes[4]);
});

test('memory reports a qualifying repeated run once even when CA has no mutable rule map', () => {
    const { subject, logs } = createHarness({
        grid: { cols: 2, rows: 1, baseDepth: 16 },
        simulation: { algorithm: 'CA', states: 2 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: false },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 0.75 }
    });
    subject.initialize();
    logs.length = 0;

    subject.step();
    subject.step();
    assert.equal(logs.length, 0);
    subject.step();
    subject.step();
    assert.equal(logs.filter(([message]) => message.includes('repetition threshold reached')).length, 1);
    assert.equal(logs.filter(([message]) => message.includes('no non-uniform CA rule')).length, 1);
    assert.ok(!logs.some(([message]) => message.includes('Memory changed CA rule')));
});

test('memory does not mutate PN rules and can be disabled', () => {
    const pn = createHarness({
        grid: { cols: 6, rows: 1, baseDepth: 2 },
        simulation: { algorithm: 'PN', states: 2 },
        initial: { mode: 'random' },
        memory: { enabled: true, capacityMultiplier: 1, matchRunFraction: 0.25 }
    }, { random: () => 0, noise: () => 0 });
    pn.subject.initialize();
    const rulesBefore = Array.from(pn.subject.algorithm.ruleMap,
        ([key, outcomes]) => [key, plain(outcomes)]);
    pn.subject.step();
    assert.ok(!pn.logs.some(([message]) => message.includes('Memory changed CA rule')));
    assert.deepEqual(Array.from(pn.subject.algorithm.ruleMap,
        ([key, outcomes]) => [key, plain(outcomes)]), rulesBefore);

    const disabled = createHarness({ memory: { enabled: false } });
    disabled.subject.initialize();
    assert.equal(disabled.subject.memory, null);
});

test('both view presets frame the entire rotated volume tightly at different aspect ratios', () => {
    for (const orientation of ['sideways', 'vertical']) {
        for (const dimensions of [[96, 96, 192], [2, 17, 1], [21, 2, 39]]) {
            const [cols, rows, baseDepth] = dimensions;
            const { subject, classes } = createHarness({
                grid: { cols, rows, baseDepth }, initial: { mode: 'random' }, view: { orientation }
            });
            const { settings } = subject;
            const { drawing, calls } = drawingStub();
            new classes.GridRenderer(settings, drawing).setup();
            const [, left, right, bottom, top, near, far] = calls.find(([name]) => name === 'ortho');
            const cell = settings.grid.cellSize;
            const { halfX, halfY } = classes.GridRenderer.projectedHalfExtents(
                [cols * cell / 2, rows * cell / 2, settings.depth * cell / 2], settings.preset.rotation);
            assert.ok(right >= halfX && -left >= halfX && bottom >= halfY && -top >= halfY);
            const pad = settings.view.cameraPadding + 1e-9;
            assert.ok(right <= halfX * pad || bottom <= halfY * pad, 'fit is tight on at least one axis');
            const radius = Math.hypot(cols, rows, settings.depth) * cell / 2;
            const [, , , cameraDistance] = calls.find(([name]) => name === 'camera');
            assert.ok(near <= cameraDistance - radius && far >= cameraDistance + radius);
            assert.ok(Math.abs(right / bottom - settings.canvasWidth / settings.canvasHeight) < 1e-12);
        }
    }
});

test('default vertical view keeps the original ortho(-420, 420, 840, -840) zoom', () => {
    const { subject, classes } = createHarness({
        grid: { cols: 96, rows: 96, baseDepth: 192, cellSize: 4 }, initial: { mode: 'random' }, view: { orientation: 'vertical' }
    });
    const { drawing, calls } = drawingStub();
    new classes.GridRenderer(subject.settings, drawing).setup();
    const [, , right, bottom] = calls.find(([name]) => name === 'ortho');
    assert.ok(Math.abs(bottom - 840) / 840 < 0.01, `half height ${bottom}`);
    assert.ok(Math.abs(right - 420) / 420 < 0.01, `half width ${right}`);
});

test('zoom scales orthographic framing without changing the camera or depth clipping', () => {
    for (const orientation of ['sideways', 'vertical']) {
        const setup = zoom => {
            const { subject, classes } = createHarness({ view: { orientation, zoom } });
            const { drawing, calls } = drawingStub();
            new classes.GridRenderer(subject.settings, drawing).setup();
            return { settings: subject.settings, classes, calls };
        };
        const baseline = setup(1);
        const camera = baseline.calls.find(([name]) => name === 'camera');
        const canvas = baseline.calls.find(([name]) => name === 'createCanvas');
        const ortho = baseline.calls.find(([name]) => name === 'ortho');
        const { grid, depth, preset, canvasWidth, canvasHeight, view } = baseline.settings;
        const { halfX, halfY } = baseline.classes.GridRenderer.projectedHalfExtents(
            [grid.cols * grid.cellSize / 2, grid.rows * grid.cellSize / 2, depth * grid.cellSize / 2],
            preset.rotation);
        const aspect = canvasWidth / canvasHeight;
        const halfHeight = Math.max(halfY, halfX / aspect) * view.cameraPadding;
        const halfWidth = halfHeight * aspect;
        assert.deepEqual(ortho.slice(1, 5), [-halfWidth, halfWidth, halfHeight, -halfHeight]);

        for (const zoom of [0.5, 2]) {
            const { calls } = setup(zoom);
            assert.deepEqual(calls.find(([name]) => name === 'camera'), camera);
            assert.deepEqual(calls.find(([name]) => name === 'createCanvas'), canvas);
            const scaled = calls.find(([name]) => name === 'ortho');
            for (let i = 1; i <= 4; i++) {
                assert.equal(scaled[i], ortho[i] / zoom);
            }
            assert.deepEqual(scaled.slice(5), ortho.slice(5));
        }
    }
});

test('zoom rejects invalid settings and unusable projection bounds', () => {
    for (const zoom of [0, -1, NaN, Infinity, '2', 3.4028234663852886e38 * 2]) {
        assert.throws(() => createHarness({ view: { zoom } }), /view\.zoom/);
    }
    for (const overrides of [
        { view: { zoom: 1e-40 } },
        { grid: { cellSize: 1e-10 }, view: { zoom: 3.4028234663852886e38 } }
    ]) {
        const { subject, classes } = createHarness(overrides);
        const { drawing, calls } = drawingStub();
        assert.throws(() => new classes.GridRenderer(subject.settings, drawing).setup(), /view\.zoom/);
        assert.equal(calls.length, 0);
    }
});

test('configuration accepts int32 and float32 boundaries and rejects out-of-range values before allocation', () => {
    const { classes, config: baseline } = createHarness();
    const resolve = overrides => {
        const config = structuredClone(baseline);
        for (const [section, values] of Object.entries(overrides)) {
            config[section] = { ...config[section], ...values };
        }
        return classes.resolveConfig(config);
    };
    const int32Max = 2147483647;
    const float32Max = 3.4028234663852886e38;

    const settings = resolve({
        grid: { cols: int32Max, baseDepth: int32Max, cellSize: 1e-10 },
        simulation: { timeInterval: int32Max },
        pn: { noiseSpaceScale: float32Max }
    });
    assert.equal(settings.depth, int32Max);
    assert.equal(settings.grid.cols, int32Max);
    assert.equal(settings.simulation.timeInterval, int32Max);
    assert.equal(settings.pn.noiseSpaceScale, float32Max);

    assert.throws(() => resolve({ grid: { cols: int32Max + 1 } }), /grid.cols/);
    assert.throws(() => resolve({ simulation: { timeInterval: int32Max + 1 } }), /timeInterval/);
    assert.throws(() => resolve({ pn: { noiseSpaceScale: float32Max * 2 } }), /noiseSpaceScale/);
    assert.throws(() => resolve({ grid: { cellSize: float32Max * 2 } }), /cellSize/);

    assert.doesNotThrow(() => resolve({
        simulation: { algorithm: 'CA' }, pn: { noiseSpaceScale: float32Max * 2 }
    }));
    assert.doesNotThrow(() => resolve({
        simulation: { algorithm: 'PN' }, ca: { neighborhoodSize: int32Max + 1 }
    }));
});

test('invalid active options fail before allocation; inactive settings are ignored', () => {
    for (const [overrides, message] of [
        [{ grid: { cols: 0 } }, /grid.cols/],
        [{ grid: { rows: 2.5 } }, /grid.rows/],
        [{ grid: { baseDepth: -1 } }, /grid.baseDepth/],
        [{ grid: { cellSize: NaN } }, /grid.cellSize/],
        [{ simulation: { algorithm: 'other' } }, /simulation.algorithm/],
        [{ simulation: { timeInterval: -1 } }, /timeInterval/],
        [{ initial: { mode: 'bad' } }, /initial.mode/],
        [{ initial: { patternSize: 9 } }, /must fit/],
        [{ initial: { symmetry: 'bad' } }, /initial.symmetry/],
        [{ initial: { placement: 'bad' } }, /initial.placement/],
        [{ initial: { placement: 'corners', loopPattern: 'yes' } }, /initial.loopPattern/],
        [{ view: { orientation: 'bad' } }, /view.orientation/],
        [{ memory: { enabled: 'yes' } }, /memory.enabled/],
        [{ memory: { enabled: true, capacityMultiplier: 0 } }, /capacityMultiplier/],
        [{ memory: { enabled: true, matchRunFraction: 0 } }, /matchRunFraction/],
        [{ simulation: { algorithm: 'CA' }, ca: { rule: 'bad' } }, /ca.rule/],
        [{ simulation: { algorithm: 'CA' }, ca: { neighborhoodSize: 2 } }, /must be odd/],
        [{ simulation: { algorithm: 'CA' }, ca: { neighborhoodSize: 0 } }, /neighborhoodSize/],
        [{ simulation: { algorithm: 'CA' }, ca: { neighborhoodSize: 1, cycleUniform: 'yes' } }, /cycleUniform/],
        [{ simulation: { algorithm: 'CA' }, ca: { rule: 'counts', neighborhoodSize: 1, emptyStateProbability: -1 } }, /emptyStateProbability/],
        [{ simulation: { algorithm: 'PN' }, pn: { noiseSpaceScale: -0.01 } }, /noiseSpaceScale/],
        [{ simulation: { algorithm: 'PN' }, pn: { noiseTimeScale: Infinity } }, /noiseTimeScale/],
        [{ simulation: { algorithm: 'PN' }, pn: { boundary: 'bad' } }, /pn.boundary/],
        [{ view: { cameraPadding: 0.5 } }, /cameraPadding/]
    ]) {
        assert.throws(() => createHarness(overrides), message);
    }
    assert.doesNotThrow(() => createHarness({
        simulation: { algorithm: 'PN' },
        ca: { rule: 'bad', neighborhoodSize: 2, emptyStateProbability: -1 },
        initial: { mode: 'random', patternSize: -1, symmetry: 'bad', placement: 'bad', loopPattern: 'bad' },
        memory: { enabled: false, capacityMultiplier: -1, matchRunFraction: -1 }
    }));
    assert.doesNotThrow(() => createHarness({
        simulation: { algorithm: 'CA' }, ca: { neighborhoodSize: 1, emptyStateProbability: 0.75 },
        pn: { forwardProbability: -1, noiseSpaceScale: 0, noiseTimeScale: 0, boundary: 'bad' }
    }));
    assert.doesNotThrow(() => createHarness({ initial: { placement: 'center', loopPattern: 'bad' } }));
});

test('a one-layer simulation completes without generating an out-of-bounds layer', () => {
    const { subject } = createHarness({ grid: { baseDepth: 1 } });
    assert.throws(() => subject.step(), /Initialize/);
    subject.initialize();
    assert.equal(subject.step(), null);
    assert.ok(subject.grid.every(column => column.every(layers => layers.length === 1)));
});

test('trajectory configuration validates ranges, noise controls, and effective-depth speed before allocation', () => {
    const { config } = createHarness();
    const trajectory = config.pn.trajectory;
    for (const [values, message] of [
        [{ slope: [0.5, 0] }, /slope/],
        [{ slope: [-0.1, 0.5] }, /slope/],
        [{ bend: [0] }, /bend/],
        [{ bend: [0, Infinity] }, /bend/],
        [{ amplitude: [-1, 0] }, /amplitude/],
        [{ wavelength: [0, 1] }, /wavelength/],
        [{ wavelength: [Number.MIN_VALUE, Number.MIN_VALUE] }, /wavelength/],
        [{ phase: [NaN, 0] }, /phase/],
        [{ phase: ['0', 1] }, /phase/],
        [{ parameterNoise: null }, /parameterNoise/],
        [{ parameterNoise: { spaceScale: -0.01, channels: 'separate' } }, /spaceScale/],
        [{ parameterNoise: { spaceScale: 0.05, channels: 'bad' } }, /channels/],
        [{ slope: [0, 2] }, /maxCellsPerAxisPerLayer/],
        [{ slope: [0, 0.5], amplitude: [1, 1], wavelength: [8, 8] }, /maxCellsPerAxisPerLayer/]
    ]) {
        assert.throws(() => createHarness({
            pn: { mode: 'trajectory', trajectory: { ...trajectory, ...values } }
        }), message);
    }
    assert.throws(() => createHarness({ pn: { mode: 'bad' } }), /pn.mode/);
    assert.throws(() => createHarness({ pn: { mode: 'trajectory', trajectory: null } }), /pn.trajectory/);
    assert.doesNotThrow(() => createHarness({ pn: { mode: 'legacy', trajectory: null } }));
    assert.doesNotThrow(() => createHarness({
        simulation: { algorithm: 'CA' }, pn: { mode: 'bad', trajectory: null }
    }));
    const curved = { ...trajectory, slope: [0, 0.5], bend: [0, 0.05], amplitude: [0, 0] };
    assert.doesNotThrow(() => createHarness({
        grid: { baseDepth: 8 }, view: { orientation: 'sideways' },
        pn: { mode: 'trajectory', trajectory: curved }
    }));
    assert.throws(() => createHarness({
        grid: { baseDepth: 8 }, view: { orientation: 'vertical' },
        pn: { mode: 'trajectory', trajectory: curved }
    }), /maxCellsPerAxisPerLayer/);
    assert.doesNotThrow(() => createHarness({
        grid: { baseDepth: 8 }, view: { orientation: 'vertical' },
        pn: { mode: 'trajectory', trajectory: curved, maxCellsPerAxisPerLayer: 2 }
    }));
});

test('all three PN scales accept zero and retain finite nonnegative float32 limits', () => {
    const { classes, config } = createHarness();
    const float32Max = 3.4028234663852886e38;
    for (const name of ['noiseSpaceScale', 'noiseTimeScale', 'parameterNoise.spaceScale']) {
        for (const value of [0, 0.01, float32Max, -0.01, NaN, Infinity, '0', null, false, float32Max * 2]) {
            const candidate = structuredClone(config);
            candidate.pn.mode = 'trajectory';
            if (name === 'parameterNoise.spaceScale') {
                candidate.pn.trajectory.parameterNoise.spaceScale = value;
            } else {
                candidate.pn[name] = value;
            }
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= float32Max) {
                assert.doesNotThrow(() => classes.resolveConfig(candidate), name);
            } else {
                assert.throws(() => classes.resolveConfig(candidate), /nonnegative finite 32-bit float/, name);
            }
        }
    }
    for (const mode of ['legacy', 'trajectory']) {
        for (const [noiseSpaceScale, noiseTimeScale, spaceScale] of [
            [0, 0, 0], [0, 0.01, 0.01], [0.01, 0, 0.01], [0.01, 0.01, 0]
        ]) {
            const candidate = structuredClone(config);
            Object.assign(candidate.pn, { mode, noiseSpaceScale, noiseTimeScale });
            candidate.pn.trajectory.parameterNoise.spaceScale = spaceScale;
            assert.doesNotThrow(() => classes.resolveConfig(candidate));
        }
    }
});

test('PN movement limit accepts positive int32 values and controls the trajectory speed bound', () => {
    const { classes, config } = createHarness();
    for (const value of [0, -1, 1.5, NaN, Infinity, '2', null, 2147483648]) {
        assert.throws(() => createHarness({ pn: { maxCellsPerAxisPerLayer: value } }),
            /pn.maxCellsPerAxisPerLayer/);
    }
    for (const value of [1, 2, 2147483647]) {
        const candidate = structuredClone(config);
        candidate.pn.maxCellsPerAxisPerLayer = value;
        assert.doesNotThrow(() => classes.resolveConfig(candidate));
    }
    assert.doesNotThrow(() => createHarness({
        simulation: { algorithm: 'CA' }, pn: { maxCellsPerAxisPerLayer: 0 }
    }));
    const candidate = structuredClone(config);
    candidate.pn.mode = 'trajectory';
    candidate.pn.trajectory.slope = [2, 2];
    candidate.pn.maxCellsPerAxisPerLayer = 2;
    assert.doesNotThrow(() => classes.resolveConfig(candidate));
    candidate.pn.maxCellsPerAxisPerLayer = 1;
    assert.throws(() => classes.resolveConfig(candidate), /speed bound 2.*maxCellsPerAxisPerLayer/);
});

test('trajectory validation logs the unrounded bound and required cap before accepting or rejecting it', () => {
    const { classes, config, logs } = createHarness();
    config.grid.baseDepth = 192;
    config.pn.mode = 'trajectory';
    config.pn.maxCellsPerAxisPerLayer = 21;
    Object.assign(config.pn.trajectory, {
        slope: [0.2, 0.2], bend: [-0.1, 0.1], amplitude: [8, 8], wavelength: [64, 128]
    });
    const speedBound = 0.2 + 0.1 * 191 + 2 * Math.PI * 8 / 64;
    const message = 'PN trajectory movement bound (cells per axis per layer):';
    classes.resolveConfig(config);
    assert.deepEqual(plain(logs), [[message, {
        speedBound, minimumIntegerLimit: 21, configuredLimit: 21, depth: 192
    }]]);

    logs.length = 0;
    config.pn.maxCellsPerAxisPerLayer = 1;
    assert.throws(() => classes.resolveConfig(config), /speed bound/);
    assert.deepEqual(plain(logs), [[message, {
        speedBound, minimumIntegerLimit: 21, configuredLimit: 1, depth: 192
    }]]);

    logs.length = 0;
    Object.assign(config.pn.trajectory, { slope: [0, 0], bend: [0, 0], amplitude: [0, 0] });
    classes.resolveConfig(config);
    assert.deepEqual(plain(logs), [[message, {
        speedBound: 0, minimumIntegerLimit: 1, configuredLimit: 1, depth: 192
    }]]);

    logs.length = 0;
    config.pn.mode = 'legacy';
    classes.resolveConfig(config);
    config.pn.mode = 'trajectory';
    config.simulation.algorithm = 'CA';
    classes.resolveConfig(config);
    assert.equal(logs.length, 0);
});
