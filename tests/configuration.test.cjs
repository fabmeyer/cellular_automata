const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { createHarness, seededRandom, drawingStub, plain, layerStates } = require('./helpers.cjs');

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

test('PN drift and steering validate inputs and default missing options compatibly', () => {
    for (const noiseDrift of [null, [], [1], [1, 2, 3], new Array(2), [NaN, 0], [0, Infinity], ['1', 0]]) {
        assert.throws(() => createHarness({ pn: { noiseDrift } }), /pn.noiseDrift/);
    }
    for (const noiseSteering of [null, 0, 'true']) {
        assert.throws(() => createHarness({ pn: { noiseSteering } }), /pn.noiseSteering/);
    }
    const { config, classes } = createHarness();
    delete config.pn.noiseDrift;
    delete config.pn.noiseSteering;
    const resolved = classes.resolveConfig(config);
    assert.deepEqual(plain(resolved.pn.noiseDrift), [0, 0]);
    assert.equal(resolved.pn.noiseSteering, false);
    const scaled = createHarness({ grid: { factor: 4 },
        pn: { noiseDrift: [0.1, -0.2], noiseSteering: true } }).subject.settings;
    assert.deepEqual(plain(scaled.pn.noiseDrift), [0.025, -0.05]);
});

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
            subject.grid.set(x, 0, 0, x);
        }
        renderer.drawLayer(subject.grid, 0);
        assert.deepEqual(calls.filter(([name]) => name === 'fill').map(([, color]) => color),
            expected, algorithm);
    }
});

test('configured state alpha overrides apply to CA and PN palettes', () => {
    for (const algorithm of ['CA', 'PN']) {
        const { subject, classes } = createHarness({
            grid: { cols: 1, rows: 1 }, simulation: { algorithm, states: 2 },
            initial: { mode: 'random' }, coloring: { state0Alpha: 0.25, otherStatesAlpha: 0.75 }
        });
        const { drawing, calls } = drawingStub();
        const renderer = new classes.GridRenderer(subject.settings, drawing, () => 0.5);
        assert.deepEqual(plain(renderer.colors), [
            'rgba(0, 0, 0, 0.25)', 'rgba(127, 127, 127, 0.75)'
        ], algorithm);
        subject.grid.set(0, 0, 0, 0);
        renderer.drawLayer(subject.grid, 0);
        subject.grid.set(0, 0, 0, 1);
        renderer.drawLayer(subject.grid, 0);
        assert.deepEqual(calls.filter(([name]) => name === 'fill').map(([, color]) => color),
            ['rgba(0, 0, 0, 0.25)', 'rgba(127, 127, 127, 0.75)'], algorithm);
    }
});

test('cells with alpha 0 are not drawn for CA and PN', () => {
    for (const algorithm of ['CA', 'PN']) {
        const { subject, classes } = createHarness({
            grid: { cols: 2, rows: 1 }, simulation: { algorithm, states: 2 },
            initial: { mode: 'random' }, ca: { neighborhoodSize: 1 },
            pn: { movementUnit: null }, coloring: { state0Alpha: 0, otherStatesAlpha: 1 }
        });
        const { drawing, calls } = drawingStub();
        const renderer = new classes.GridRenderer(subject.settings, drawing, () => 0.5);
        subject.initialize();
        subject.grid.set(0, 0, 0, 0);
        subject.grid.set(1, 0, 0, 1);
        renderer.drawLayer(subject.grid, 0);
        assert.deepEqual(calls.filter(([name]) => name === 'fill').map(([, color]) => color),
            ['rgb(127, 127, 127)'], algorithm);
    }
});

test('PN position mode omits empty cells when state 0 alpha is 0', () => {
    const { subject, classes } = createHarness({
        grid: { cols: 2, rows: 2, baseDepth: 2 }, simulation: { algorithm: 'PN', states: 2, numGenerations: 2 },
        initial: { mode: 'random' }, memory: { enabled: false },
        pn: { movementUnit: 1 }, coloring: { state0Alpha: 0 }
    }, { random: () => 0.75 });
    const renderer = new classes.GridRenderer(subject.settings, drawingStub().drawing, () => 0.5);
    subject.initialize();
    const cells = [...renderer.positionCells(subject.grid, 0)];
    assert.ok(cells.length > 0);
    assert.ok(cells.every(cell => cell.state !== 0));
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
                        assert.ok(subject.grid.layers.every(layer => layer.every(state => state < states)), label);
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
                    const generations = Array.from({ length: 8 }, (_, z) => layerStates(subject.grid, z));
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
        const occupied = layerStates(subject.grid, 0).flat()
            .filter(state => state !== 0).length;
        const expected = initial.mode === 'random' || initial.placement === 'tiled' ? 30 : 16;
        assert.equal(occupied, expected, JSON.stringify(initial));
        if (initial.placement === 'corners') {
            assert.equal(subject.grid.get(0, 0, 0), 1);
            assert.equal(subject.grid.get(5, 4, 0), 1);
            assert.equal(subject.grid.get(2, 2, 0), 0);
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
                const state = (x, y) => subject.grid.get(x, y, 0);
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
    const state = (x, y) => subject.grid.get(x, y, 0);
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
    assert.deepEqual(plain(layerStates(subject.grid, 0)),
        [[0, 0, 1], [0, 0, 1], [2, 2, 3]]);
});

test('length-8 seeds expand 16 coarse states into 2x2 blocks and preserve D4 symmetry', () => {
    for (const [symmetry, coarse] of [
        ['plain', [[0, 1, 2, 3], [4, 5, 6, 7], [8, 0, 1, 2], [3, 4, 5, 6]]],
        ['D4', [[0, 1, 1, 0], [1, 5, 5, 1], [1, 5, 5, 1], [0, 1, 1, 0]]]
    ]) {
        let draws = 0;
        const { subject } = createHarness({
            simulation: { states: 9 },
            initial: { patternSize: 8, resolutionFactor: 2, symmetry, placement: 'tiled' }
        }, { random: () => (draws++ % 9 + 0.5) / 9 });
        subject.initialize();
        const expected = coarse.flatMap(column => {
            const expanded = column.flatMap(state => [state, state]);
            return [expanded, expanded];
        });
        assert.deepEqual(layerStates(subject.grid, 0), expected, symmetry);
        assert.equal(draws, 16, symmetry);
        if (symmetry === 'D4') {
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < 8; y++) {
                    for (const [i, j] of [[y, 7 - x], [7 - x, 7 - y], [7 - y, x],
                        [x, 7 - y], [7 - x, y], [y, x], [7 - y, 7 - x]]) {
                        assert.equal(subject.grid.get(x, y, 0), subject.grid.get(i, j, 0));
                    }
                }
            }
        }
    }
});

test('coarse seeds retain tile anchors, corner surroundings, and last-stamp-wins overlaps', () => {
    for (const initial of initializers.filter(options => options.mode === 'seed')) {
        for (const [cols, rows] of [[15, 13], [7, 7]]) {
            let draws = 0;
            const { subject } = createHarness({
                grid: { cols, rows }, simulation: { states: 9 },
                initial: { ...initial, patternSize: 6, resolutionFactor: 2 }
            }, { random: () => (draws++ + 0.5) / 9 });
            subject.initialize();
            const coarse = initial.symmetry === 'D4'
                ? [[0, 1, 0], [1, 4, 1], [0, 1, 0]] : [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
            const tile = coarse.flatMap(column => {
                const expanded = column.flatMap(state => [state, state]);
                return [expanded, expanded];
            });
            const origins = initial.placement === 'corners'
                ? [[0, 0], [cols - 6, 0], [0, rows - 6], [cols - 6, rows - 6]]
                : initial.placement === 'center'
                    ? [[Math.floor((cols - 6) / 2), Math.floor((rows - 6) / 2)]] : [[0, 0]];
            const [anchorX, anchorY] = origins[0];
            const expected = Array.from({ length: cols }, (_, x) =>
                Array.from({ length: rows }, (_, y) =>
                    initial.placement === 'corners' && !initial.loopPattern ? 0
                        : tile[((x - anchorX) % 6 + 6) % 6][((y - anchorY) % 6 + 6) % 6]));
            for (const [originX, originY] of origins) {
                for (let x = 0; x < 6; x++) {
                    for (let y = 0; y < 6; y++) {
                        expected[originX + x][originY + y] = tile[x][y];
                    }
                }
            }
            const label = JSON.stringify({ initial, cols, rows });
            assert.deepEqual(layerStates(subject.grid, 0), expected, label);
            assert.equal(draws, 9, label);
        }
    }
});

test('random initialization draws once per block, clipping rectangular edges and oversized factors', () => {
    for (const [resolutionFactor, expected, expectedDraws] of [
        [2, [[0, 0, 1], [0, 0, 1], [2, 2, 3], [2, 2, 3], [4, 4, 5]], 6],
        [2147483647, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], 1]
    ]) {
        let draws = 0;
        const { subject } = createHarness({
            grid: { cols: 5, rows: 3 }, simulation: { states: 9 },
            initial: { mode: 'random', resolutionFactor, patternSize: -1,
                symmetry: 'bad', placement: 'bad', loopPattern: 'bad' }
        }, { random: () => (draws++ + 0.5) / 9 });
        subject.initialize();
        assert.deepEqual(layerStates(subject.grid, 0), expected);
        assert.equal(draws, expectedDraws);
    }
});

test('factor 1 preserves x-major random draws and existing plain/D4 seed states', () => {
    for (const [initial, expected, expectedDraws] of [
        [{ mode: 'random' }, [[0, 1, 2], [3, 4, 5], [6, 7, 8]], 9],
        [{ mode: 'seed', symmetry: 'plain', patternSize: 2, placement: 'tiled' },
            [[0, 1, 0], [2, 3, 2], [0, 1, 0]], 4],
        [{ mode: 'seed', symmetry: 'D4', patternSize: 3, placement: 'tiled' },
            [[0, 1, 0], [1, 4, 1], [0, 1, 0]], 9]
    ]) {
        let draws = 0;
        const { subject } = createHarness({
            grid: { cols: 3, rows: 3 }, simulation: { states: 9 }, initial
        }, { random: () => (draws++ + 0.5) / 9 });
        subject.initialize();
        assert.deepEqual(layerStates(subject.grid, 0), expected);
        assert.equal(draws, expectedDraws);
    }
});

test('initial resolution factors reject invalid effective sizes and nondivisible seed lengths', () => {
    for (const mode of ['seed', 'random']) {
        for (const resolutionFactor of [0, -1, 1.5, NaN, Infinity, 2147483648, '2', undefined]) {
            assert.throws(() => createHarness({ initial: { mode, resolutionFactor } }),
                /initial.resolutionFactor must be a positive 32-bit integer/);
        }
    }
    for (const resolutionFactor of [3, 9]) {
        assert.throws(() => createHarness({ initial: { patternSize: 8, resolutionFactor } }),
            /initial.resolutionFactor must divide initial.patternSize exactly/);
    }
    const { subject } = createHarness({
        initial: { patternSize: 8, resolutionFactor: 8 }
    }, { random: () => 0.75 });
    subject.initialize();
    assert.ok(subject.grid.layer(0).every(state => state === 6));
});

test('fractional resolution factors produce integral blocks after grid scaling', () => {
    for (const mode of ['seed', 'random']) {
        for (const [resolutionFactor, effective] of [[0.25, 1], [0.5, 2], [1.5, 6]]) {
            let draws = 0;
            const { subject, config } = createHarness({
                grid: { factor: 4, cols: 12, rows: 12 },
                simulation: { states: 3 },
                initial: { mode, patternSize: 3, resolutionFactor, symmetry: 'plain', placement: 'tiled' }
            }, { random: () => (draws++ % 3 + 0.5) / 3 });
            subject.initialize();
            assert.equal(config.initial.resolutionFactor, resolutionFactor);
            assert.equal(subject.settings.initial.resolutionFactor, effective);
            assert.equal(draws, (12 / effective) ** 2);
            for (let x = 0; x < 12; x++) {
                for (let y = 0; y < 12; y++) {
                    assert.equal(subject.grid.get(x, y, 0),
                        subject.grid.get(Math.floor(x / effective) * effective,
                            Math.floor(y / effective) * effective, 0));
                }
            }
        }
    }
});

test('fractional resolution factors reject nonintegral or too-small effective sizes', () => {
    for (const mode of ['seed', 'random']) {
        for (const resolutionFactor of [0.2, 0.375]) {
            assert.throws(() => createHarness({
                grid: { factor: 4 }, initial: { mode, resolutionFactor }
            }), /initial\.resolutionFactor must be a positive 32-bit integer/);
        }
    }
    assert.throws(() => createHarness({
        grid: { factor: 4, cols: 12, rows: 12 },
        initial: { mode: 'seed', patternSize: 3, resolutionFactor: 1.25 }
    }), /initial\.resolutionFactor must divide initial\.patternSize exactly/);
});

test('CA and PN evolve coarse initial blocks at full cell resolution', () => {
    for (const algorithm of ['CA', 'PN']) {
        const overrides = {
            simulation: { algorithm, states: 3 },
            initial: { patternSize: 8, symmetry: 'plain', placement: 'tiled' },
            ca: { rule: 'majority', neighborhoodSize: 3, cycleUniform: true },
            pn: { forwardProbability: 1, noiseSpaceScale: 1 },
            memory: { enabled: false }
        };
        const noise = x => x % 2 === 0 ? 0.5 : 0.7;
        const { subject: coarse } = createHarness({
            ...overrides, initial: { ...overrides.initial, resolutionFactor: 4 }
        }, { random: seededRandom(7), noise });
        const { subject: baseline } = createHarness(overrides, { random: seededRandom(7), noise });
        coarse.initialize();
        baseline.initialize();
        baseline.grid.layer(0).set(coarse.grid.layer(0));
        baseline.algorithm.initialize(baseline.grid);
        for (let z = 1; z <= 2; z++) {
            coarse.step();
            baseline.step();
            assert.deepEqual(layerStates(coarse.grid, z), layerStates(baseline.grid, z), algorithm);
        }
        assert.ok(layerStates(coarse.grid, 1).some((column, x) =>
            column.some((state, y) =>
                state !== coarse.grid.get(Math.floor(x / 4) * 4, Math.floor(y / 4) * 4, 1))),
        `${algorithm} must not force later generations into uniform initial blocks`);
    }
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
    subject.grid.set(0, 0, 0, 1);
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
    subject.grid.set(4, 0, 0, 1);
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

    subject.grid.set(4, 0, 2, 1);
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
            subject.grid.set(x, y, 0, x);
        }
    }
    for (let z = 1; z <= 5; z++) {
        subject.step();
    }
    assert.deepEqual(layerStates(subject.grid, 3),
        layerStates(subject.grid, 0));
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
            grid.set(0, y, z, ((z % 48) >> y) & 1);
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
                grid.set(0, y, z, ((z % period) >> y) & 1);
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

test('color alpha settings accept null or values in [0, 1] and reject out-of-range values', () => {
    const { classes, config } = createHarness();
    for (const value of [null, 0, 1, 0.5]) {
        for (const name of ['state0Alpha', 'otherStatesAlpha']) {
            config.coloring[name] = value;
            assert.doesNotThrow(() => classes.resolveConfig(config), name);
        }
    }
    for (const value of [-0.01, 1.01, NaN]) {
        config.coloring.state0Alpha = null;
        config.coloring.otherStatesAlpha = null;
        for (const name of ['state0Alpha', 'otherStatesAlpha']) {
            config.coloring[name] = value;
            assert.throws(() => classes.resolveConfig(config), new RegExp(`coloring\\.${name}`), name);
            config.coloring[name] = null;
        }
    }
    for (const value of [0, 0.5, 1]) {
        config.coloring.shading = value;
        assert.doesNotThrow(() => classes.resolveConfig(config));
    }
    for (const value of [-0.01, 1.01, NaN, null]) {
        config.coloring.shading = value;
        assert.throws(() => classes.resolveConfig(config), /coloring\.shading/);
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
            grid.set(0, y, z, (value >> y) & 1);
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
    const grid = new classes.StateGrid(1, 1, 5);
    [0, 1, 0, 2, 0].forEach((state, z) => grid.set(0, 0, z, state));
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
    const grid = new classes.StateGrid(1, 3, stripes.length);
    stripes.forEach((stripe, z) => stripe.forEach((state, y) => grid.set(0, y, z, state)));
    for (let z = 0; z < 4; z++) {
        assert.equal(memory.addLayer(grid, z), false);
    }
    assert.equal(memory.addLayer(grid, 4), true);
    assert.equal(memory.latestPeriod, 4);
    assert.equal(memory.items.length, 4);
    assert.deepEqual(Array.from(memory.getLatestRow()), stripes[4]);
});

test('rolling simulations release consumed grid and PN outside layers without changing output', () => {
    for (const algorithm of ['CA', 'PN']) {
        const overrides = {
            grid: { cols: 4, rows: 4, baseDepth: 6 },
            simulation: { algorithm, states: 3, numGenerations: 6, retainHistory: true },
            initial: { mode: 'random' },
            pn: { boundary: 'grow', maxCellsPerAxisPerLayer: 1 },
            memory: { enabled: true }
        };
        const noise = (x, y, z) => (x + y + z) % 1;
        const { subject: full, classes, config } = createHarness(overrides, {
            random: seededRandom(42), noise
        });
        const rollingConfig = { ...config, simulation: { ...config.simulation, retainHistory: false } };
        const rolling = new classes.Simulation(rollingConfig, seededRandom(42), noise);
        assert.equal(rolling.grid.retainHistory, false);
        full.initialize();
        rolling.initialize();

        const initial = layerStates(full.grid, 0);
        assert.deepEqual(layerStates(rolling.grid, 0), initial);
        for (let z = 1; z < rolling.settings.simulation.numGenerations; z++) {
            assert.equal(rolling.step(), z);
            assert.equal(full.step(), z);
            assert.deepEqual(layerStates(rolling.grid, z), layerStates(full.grid, z), `${algorithm} layer ${z}`);
            assert.equal(rolling.grid.layers[z - 1], null);
            assert.equal(rolling.grid.layers.filter(layer => layer !== null).length, 1);
            assert.throws(() => rolling.grid.layer(z - 1), /already been released/);
            if (algorithm === 'PN') {
                assert.deepEqual(plain(Array.from(rolling.grid.outsideLayers[z].entries())),
                    plain(Array.from(full.grid.outsideLayers[z].entries())), `PN outside layer ${z}`);
                assert.equal(rolling.grid.outsideLayers[z - 1], null);
            }
        }
        assert.equal(rolling.step(), null);
        assert.deepEqual(layerStates(full.grid, 0), initial);
        if (algorithm === 'PN') {
            assert.ok(full.grid.outsideLayers.some(layer => layer?.size > 0));
        }
        rolling.initialize();
        assert.equal(rolling.step(), 1);
        assert.equal(rolling.grid.layers[0], null);
    }
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

test('generation count independently controls retained layers and termination', () => {
    for (const orientation of ['sideways', 'vertical']) {
        for (const generations of [1, 2, 5]) {
            for (const [algorithm, mode, boundary] of [
                ['CA', 'legacy', 'wrap'], ['PN', 'legacy', 'wrap'],
                ['PN', 'legacy', 'grow'], ['PN', 'trajectory', 'wrap'], ['PN', 'trajectory', 'grow']
            ]) {
                const { subject } = createHarness({
                    grid: { cols: 2, rows: 2, baseDepth: 2 },
                    simulation: { algorithm, states: 2, numGenerations: generations },
                    initial: { mode: 'random' }, view: { orientation },
                    pn: { mode, boundary, forwardProbability: 1 },
                    memory: { enabled: true }
                }, { random: () => 0.75, noise: () => 0.5 });
                const depth = orientation === 'vertical' ? 4 : 2;
                assert.equal(subject.settings.depth, depth);
                assert.equal(subject.settings.simulation.numGenerations, generations);
                subject.initialize();
                for (let z = 1; z < generations; z++) {
                    assert.equal(subject.step(), z);
                }
                assert.equal(subject.step(), null);
                assert.equal(subject.step(), null);
                assert.equal(subject.grid.layers.length, generations);
                assert.equal(subject.memory.quarterDepth, Math.floor(depth / 4));
            }
        }
    }
});

test('configured generation count uses grid depth and view preset, and rejects invalid values', () => {
    const { context } = createHarness();
    vm.runInContext("CONFIG.view.orientation = 'sideways'", context);
    const sidewaysGenerations = vm.runInContext('CONFIG.simulation.numGenerations', context);
    for (const orientation of ['sideways', 'vertical']) {
        vm.runInContext(`CONFIG.view.orientation = '${orientation}'`, context);
        assert.equal(vm.runInContext('CONFIG.simulation.numGenerations', context),
            sidewaysGenerations * vm.runInContext('CONFIG.view.presets[CONFIG.view.orientation].depthMultiplier', context));
    }
    vm.runInContext('CONFIG.grid.factor *= 2', context);
    assert.equal(vm.runInContext('CONFIG.simulation.numGenerations', context),
        sidewaysGenerations * vm.runInContext('2 * CONFIG.view.presets[CONFIG.view.orientation].depthMultiplier', context));
    for (const generations of [0, -1, 1.5, NaN, Infinity, '2', null, undefined, 2147483648]) {
        assert.throws(() => createHarness({ simulation: { numGenerations: generations } }), /simulation\.numGenerations/);
    }
    const { classes, config } = createHarness();
    Object.assign(config.grid, { cols: 1, rows: 1, baseDepth: 1, cellSize: 1e38 });
    config.initial.mode = 'random';
    config.view.presets.sideways.canvasScale = [1e-38, 1e-38];
    config.simulation.numGenerations = 10;
    assert.throws(() => classes.resolveConfig(config), /finite float32 layer positions/);
});

test('grid factor scales effective settings without mutating the factor-1 inputs', () => {
    const make = factor => createHarness({
        grid: { factor, cols: 8 * factor, rows: 8 * factor, baseDepth: 8 * factor },
        simulation: { algorithm: 'PN', states: 3, numGenerations: 8 * factor },
        initial: { patternSize: 4, resolutionFactor: 2 },
        pn: {
            mode: 'trajectory', noiseSpaceScale: 0.08, noiseTimeScale: 0.12,
            maxCellsPerAxisPerLayer: 10,
            trajectory: {
                slope: [0.2, 0.4], bend: [-0.01, 0.02], amplitude: [1, 2],
                wavelength: [8, 16], phase: [0, 1],
                parameterNoise: { spaceScale: 0.04, channels: 'shared' }
            }
        },
        memory: { enabled: true, capacityMultiplier: 2, matchRunFraction: 0.5 }
    });
    const base = make(1);
    const refined = make(4);
    const a = base.subject.settings;
    const b = refined.subject.settings;
    assert.equal(b.initial.patternSize, a.initial.patternSize * 4);
    assert.equal(b.initial.resolutionFactor, a.initial.resolutionFactor * 4);
    assert.equal(b.pn.noiseSpaceScale, a.pn.noiseSpaceScale / 4);
    assert.equal(b.pn.noiseTimeScale, a.pn.noiseTimeScale / 4);
    assert.equal(b.pn.trajectory.parameterNoise.spaceScale, a.pn.trajectory.parameterNoise.spaceScale / 4);
    for (const name of ['amplitude', 'wavelength']) {
        assert.deepEqual(plain(b.pn.trajectory[name]), plain(a.pn.trajectory[name].map(value => value * 4)));
    }
    assert.deepEqual(plain(b.pn.trajectory.bend), plain(a.pn.trajectory.bend.map(value => value / 4)));
    for (const name of ['slope', 'phase']) {
        assert.deepEqual(plain(b.pn.trajectory[name]), plain(a.pn.trajectory[name]));
    }
    assert.equal(b.memoryCapacity, a.memoryCapacity * 4);
    assert.equal(b.matchRunLength, a.matchRunLength * 4);
    assert.equal(b.ca.neighborhoodSize, a.ca.neighborhoodSize);
    assert.equal(b.pn.maxCellsPerAxisPerLayer, a.pn.maxCellsPerAxisPerLayer);
    assert.deepEqual(plain(b.coloring), plain(a.coloring));
    assert.equal(refined.config.initial.patternSize, 4);
    assert.equal(refined.config.pn.noiseSpaceScale, 0.08);
    assert.deepEqual(plain(refined.classes.resolveConfig(refined.config).pn), plain(b.pn));
});

test('seeded initial patterns and colors align across grid factors', () => {
    for (const initial of [
        { mode: 'random' },
        ...['tiled', 'center', 'corners'].map(placement =>
            ({ mode: 'seed', patternSize: 4, symmetry: 'D4', placement, loopPattern: false }))
    ]) {
        const run = factor => {
            const { classes, config, context } = createHarness({
                grid: { factor, cols: 8 * factor, rows: 8 * factor, baseDepth: 8 * factor },
                simulation: { algorithm: 'CA', states: 3, seed: 42, numGenerations: 2 },
                initial, memory: { enabled: false }
            });
            const subject = new classes.Simulation(config);
            subject.initialize();
            const colors = new classes.GridRenderer(subject.settings, drawingStub().drawing,
                vm.runInContext('createSeededRandom(42)', context)).colors;
            return { subject, colors };
        };
        const base = run(1);
        const refined = run(4);
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                for (let dx = 0; dx < 4; dx++) {
                    for (let dy = 0; dy < 4; dy++) {
                        assert.equal(refined.subject.grid.get(x * 4 + dx, y * 4 + dy, 0),
                            base.subject.grid.get(x, y, 0), JSON.stringify(initial));
                    }
                }
            }
        }
        const baseAgain = run(1);
        assert.deepEqual(layerStates(base.subject.grid, 0), layerStates(baseAgain.subject.grid, 0));
        assert.deepEqual(plain(base.colors), plain(refined.colors));
    }
});

test('CA neighborhood and per-layer update cadence do not scale with grid factor', () => {
    for (const factor of [1, 4]) {
        const { subject } = createHarness({
            grid: { factor, cols: 2 * factor, rows: 2 * factor, baseDepth: 4 * factor },
            simulation: { algorithm: 'CA', states: 3, numGenerations: 3 },
            initial: { mode: 'random' }, ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: true },
            memory: { enabled: false }
        });
        assert.equal(subject.settings.ca.neighborhoodSize, 1);
        subject.initialize();
        subject.step();
        assert.equal(subject.grid.get(0, 0, 1), 1);
        subject.step();
        assert.equal(subject.grid.get(0, 0, 2), 2);
    }
});

test('fractional grid factors below one are accepted when scaled settings remain valid', () => {
    const { classes, config } = createHarness({
        grid: { factor: 0.25, cols: 2, rows: 2, baseDepth: 2 },
        simulation: { numGenerations: 2 },
        initial: { mode: 'random', resolutionFactor: 4 },
        memory: { enabled: false }
    });
    const resolved = classes.resolveConfig(config);
    assert.equal(resolved.grid.factor, 0.25);
    assert.equal(resolved.initial.resolutionFactor, 1);
});

test('memory counts stay positive integers when scaled by fractional grid factors', () => {
    for (const [factor, resolutionFactor, expected] of [[0.25, 4, 20], [0.01, 100, 1]]) {
        const { classes, config } = createHarness();
        Object.assign(config.grid, { factor, cols: 2, rows: 2, baseDepth: 2 });
        Object.assign(config.simulation, { numGenerations: 2 });
        Object.assign(config.initial, { mode: 'random', resolutionFactor });
        config.memory.enabled = true;

        const simulation = new classes.Simulation(config, () => 0, () => 0);
        assert.equal(simulation.settings.memoryCapacity, expected);
        assert.equal(simulation.settings.matchRunLength, expected);
    }
});

test('factor and seed reject invalid values and validate scaled results', () => {
    for (const factor of [0, -1, NaN, Infinity, '4', null, undefined, 2147483648]) {
        assert.throws(() => createHarness({ grid: { factor } }), /grid\.factor/);
    }
    for (const seed of [-1, 1.5, NaN, Infinity, '1', undefined, 4294967296]) {
        assert.throws(() => createHarness({ simulation: { seed } }), /simulation\.seed/);
    }
    for (const seed of [null, 0, 4294967295]) {
        assert.doesNotThrow(() => createHarness({ simulation: { seed } }));
    }
    assert.throws(() => createHarness({
        grid: { factor: 4 }, initial: { mode: 'random', resolutionFactor: 1073741824 }
    }), /initial\.resolutionFactor/);
    assert.throws(() => createHarness({
        grid: { factor: 4 }, simulation: { algorithm: 'PN' },
        pn: { mode: 'trajectory', trajectory: {
            slope: [0, 0], bend: [0, 0], amplitude: [0, 1e38], wavelength: [1, 1],
            phase: [0, 0], parameterNoise: { spaceScale: 0, channels: 'shared' }
        } }
    }), /pn\.trajectory\.amplitude/);
    const { classes, config } = createHarness();
    delete config.grid.factor;
    delete config.simulation.seed;
    const settings = classes.resolveConfig(config);
    assert.equal(settings.initial.resolutionFactor, config.initial.resolutionFactor);
    assert.equal(settings.simulation.seed, null);
});

test('changing generation count preserves shared layers and depth-based memory', () => {
    for (const [algorithm, mode, boundary] of [
        ['CA', 'legacy', 'wrap'], ['PN', 'legacy', 'wrap'],
        ['PN', 'legacy', 'grow'], ['PN', 'trajectory', 'wrap'], ['PN', 'trajectory', 'grow']
    ]) {
        const run = generations => {
            const { subject } = createHarness({
                grid: { cols: 2, rows: 2, baseDepth: 20 },
                simulation: { algorithm, states: 2, numGenerations: generations },
                initial: { mode: 'random' }, memory: { enabled: true },
                pn: { mode, boundary, forwardProbability: 1 }
            }, { random: seededRandom(), noise: () => 0.5 });
            subject.initialize();
            for (let z = 1; z < 3; z++) subject.step();
            return {
                layers: Array.from({ length: 3 }, (_, z) => layerStates(subject.grid, z)),
                capacity: subject.memory.capacity,
                quarterDepth: subject.memory.quarterDepth
            };
        };
        const short = run(3);
        assert.deepEqual(run(30), short);
        assert.equal(short.capacity, 5);
        assert.equal(short.quarterDepth, 5);
    }
});

test('layers beyond depth retain their positions and do not reframe the camera', () => {
    const trajectory = { ...createHarness().config.pn.trajectory, slope: [1, 1] };
    for (const mode of ['legacy', 'trajectory']) {
        const make = generations => {
            const harness = createHarness({
                grid: { cols: 1, rows: 1, baseDepth: 2 },
                simulation: { algorithm: 'PN', states: 2, numGenerations: generations },
                initial: { mode: 'random' }, memory: { enabled: false },
                pn: { mode, boundary: 'grow', forwardProbability: 1,
                    trajectory }
            }, { random: () => 0.75, noise: () => 5.5 / 9 });
            const { drawing, calls } = drawingStub();
            const renderer = new harness.classes.GridRenderer(harness.subject.settings, drawing);
            renderer.setup();
            return { ...harness, renderer, calls };
        };
        const baseline = make(2);
        const extended = make(5);
        assert.deepEqual(extended.calls.filter(([name]) => name === 'camera' || name === 'ortho'),
            baseline.calls.filter(([name]) => name === 'camera' || name === 'ortho'));
        extended.subject.initialize();
        for (let z = 1; z < 5; z++) {
            assert.equal(extended.subject.step(), z);
        }
        assert.deepEqual(plain(extended.subject.grid.outsideLayers[4].get('4,0')),
            { x: 4, y: 0, state: 1 });
        extended.renderer.drawLayer(extended.subject.grid, 4);
        assert.deepEqual(extended.calls.filter(([name]) => name === 'translate').at(-1),
            ['translate', 16, 0, 14]);
    }
});

test('frame scheduling stops at the configured generation count', () => {
    for (const generations of [1, 5]) {
        const { context, config } = createHarness({
            grid: { cols: 2, rows: 2, baseDepth: 2 },
            simulation: { algorithm: 'CA', states: 2, numGenerations: generations, timeInterval: 3 },
            ca: { rule: 'majority', neighborhoodSize: 1 },
            initial: { mode: 'random' }, memory: { enabled: false }
        });
        const { drawing, calls } = drawingStub();
        const pending = [];
        Object.assign(context, drawing, {
            testConfig: config,
            noiseSeed() {},
            setTimeout(callback, delay) { pending.push({ callback, delay }); }
        });
        vm.runInContext('Object.assign(CONFIG, testConfig); setup();', context);
        for (let z = 1; z < generations; z++) {
            assert.equal(pending.length, 1);
            const { callback, delay } = pending.shift();
            assert.equal(delay, 3);
            callback();
        }
        assert.equal(pending.length, 0);
        assert.equal(calls.filter(([name]) => name === 'box').length, 4 * generations);
        assert.equal(vm.runInContext('simulation.nextZ', context), generations);
    }
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

test('density and antialias are applied on a small canvas before the requested WebGL allocation', () => {
    for (const antialias of [true, false]) {
        const { subject, classes } = createHarness({ view: { antialias } });
        const { drawing, calls } = drawingStub();
        new classes.GridRenderer(subject.settings, drawing).setup();
        const setAttributesIndex = calls.findIndex(([name]) => name === 'setAttributes');
        const allocationIndex = calls.findIndex(([name, w, h]) =>
            name === 'createCanvas' && w === subject.settings.canvasWidth && h === subject.settings.canvasHeight);
        assert.deepEqual(calls[setAttributesIndex], ['setAttributes', 'antialias', antialias]);
        assert.deepEqual(calls.find(([name]) => name === 'createCanvas'), ['createCanvas', 1, 1, drawing.WEBGL]);
        assert.ok(setAttributesIndex < allocationIndex);
        assert.ok(calls.findIndex(([name]) => name === 'pixelDensity') < allocationIndex);
        assert.deepEqual(calls.find(([name]) => name === 'pixelDensity'), ['pixelDensity', 1]);
    }
});

test('WebGL allocation enforces real hardware limits without imposing a 4096 pixel cap', () => {
    const { subject, classes } = createHarness();
    const settings = { ...subject.settings, canvasWidth: 5000, canvasHeight: 32 };
    const supported = drawingStub();
    new classes.GridRenderer(settings, supported.drawing).setup();
    assert.ok(supported.calls.some(([name, w, h]) => name === 'createCanvas' && w === 5000 && h === 32));
    for (const parameter of ['texture', 'renderbuffer', 'viewport']) {
        const { drawing, calls } = drawingStub();
        drawing.drawingContext.getParameter = name => name === 'viewport'
            ? [name === parameter ? 4096 : 16384, 16384] : name === parameter ? 4096 : 16384;
        assert.throws(() => new classes.GridRenderer(settings, drawing).setup(), /5000.*32.*limit/i);
        assert.ok(!calls.some(([name, w]) => name === 'createCanvas' && w === 5000));
    }
});

test('WebGL allocation reports truncated buffers and allocation errors before shader creation', () => {
    const { subject, classes } = createHarness();
    for (const failure of ['dimensions', 1282, 1285, 'lost']) {
        const { drawing } = drawingStub();
        const create = drawing.createCanvas;
        drawing.createCanvas = (...args) => {
            const result = create(...args);
            if (args[0] === 1) return result;
            if (failure === 'dimensions') drawing.canvas.width--;
            if (typeof failure === 'number') drawing.drawingContext.getError = () => failure;
            if (failure === 'lost') drawing.drawingContext.isContextLost = () => true;
            return result;
        };
        const renderer = new classes.GridRenderer(subject.settings, drawing);
        renderer.createInstancing = () => assert.fail('must not initialize shaders after allocation failure');
        assert.throws(() => renderer.setup(), /WebGL.*(allocation|context|buffer)/i);
    }
});

test('context loss during shader use reports the WebGL failure without masking unrelated shader errors', () => {
    const { subject, classes } = createHarness();
    subject.initialize();
    for (const lost of [false, true]) {
        const { drawing } = drawingStub();
        const renderer = new classes.GridRenderer(subject.settings, drawing);
        renderer.setup();
        renderer.instancing = {
            states: { pixels: new Uint8Array(subject.settings.grid.cols * subject.settings.grid.rows * 4),
                updatePixels() {} },
            shader: { setUniform() {} }, palette: [], cube: {}
        };
        drawing.shader = () => {
            drawing.drawingContext.isContextLost = () => lost;
            throw new Error('shaderSource failed');
        };
        assert.throws(() => renderer.drawLayer(subject.grid, 0), lost ? /WebGL context lost/ : /shaderSource failed/);
    }
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
        const canvas = baseline.calls.filter(([name]) => name === 'createCanvas').at(-1).slice(0, 4);
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
            assert.deepEqual(calls.filter(([name]) => name === 'createCanvas').at(-1).slice(0, 4), canvas);
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
        [{ view: { antialias: 'yes' } }, /view.antialias/],
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

test('simulation history retention requires a boolean', () => {
    for (const retainHistory of [undefined, null, 0, 1, 'false']) {
        assert.throws(() => createHarness({ simulation: { retainHistory } }), /simulation\.retainHistory/);
    }
});

test('a one-layer simulation completes without generating an out-of-bounds layer', () => {
    const { subject } = createHarness({ grid: { baseDepth: 1 } });
    assert.throws(() => subject.step(), /Initialize/);
    subject.initialize();
    assert.equal(subject.step(), null);
    assert.equal(subject.grid.layers.length, 1);
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

test('trajectory speed validation uses generations rather than view depth', () => {
    const { config } = createHarness();
    const trajectory = { ...config.pn.trajectory, slope: [0, 0], bend: [0, 0.1] };
    const options = {
        grid: { baseDepth: 2 },
        pn: { mode: 'trajectory', trajectory, maxCellsPerAxisPerLayer: 1 }
    };
    assert.doesNotThrow(() => createHarness({ ...options, simulation: { numGenerations: 2 } }));
    assert.throws(() => createHarness({ ...options, simulation: { numGenerations: 20 } }),
        /speed bound.*maxCellsPerAxisPerLayer/);
    const tinyWavelength = {
        ...options,
        pn: { ...options.pn, trajectory: { ...trajectory, bend: [0, 0], wavelength: [1e-305, 1e-305] } }
    };
    assert.doesNotThrow(() => createHarness({ ...tinyWavelength, simulation: { numGenerations: 2 } }));
    assert.throws(() => createHarness({ ...tinyWavelength, simulation: { numGenerations: 1000 } }),
        /wavelength.*finite curve evaluation/);
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
    config.simulation.numGenerations = 192;
    config.pn.mode = 'trajectory';
    config.pn.maxCellsPerAxisPerLayer = 21;
    Object.assign(config.pn.trajectory, {
        slope: [0.2, 0.2], bend: [-0.1, 0.1], amplitude: [8, 8], wavelength: [64, 128]
    });
    const speedBound = 0.2 + 0.1 * 191 + 2 * Math.PI * 8 / 64;
    const message = 'PN trajectory movement bound (cells per axis per layer):';
    classes.resolveConfig(config);
    assert.deepEqual(plain(logs), [[message, {
        speedBound, minimumIntegerLimit: 21, configuredLimit: 21, numGenerations: 192
    }]]);

    logs.length = 0;
    config.pn.maxCellsPerAxisPerLayer = 1;
    assert.throws(() => classes.resolveConfig(config), /speed bound/);
    assert.deepEqual(plain(logs), [[message, {
        speedBound, minimumIntegerLimit: 21, configuredLimit: 1, numGenerations: 192
    }]]);

    logs.length = 0;
    Object.assign(config.pn.trajectory, { slope: [0, 0], bend: [0, 0], amplitude: [0, 0] });
    classes.resolveConfig(config);
    assert.deepEqual(plain(logs), [[message, {
        speedBound: 0, minimumIntegerLimit: 1, configuredLimit: 1, numGenerations: 192
    }]]);

    logs.length = 0;
    config.pn.mode = 'legacy';
    classes.resolveConfig(config);
    config.pn.mode = 'trajectory';
    config.simulation.algorithm = 'CA';
    classes.resolveConfig(config);
    assert.equal(logs.length, 0);
});
