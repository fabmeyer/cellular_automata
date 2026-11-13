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
            initial: { mode: 'random' }
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
            ca: { rule, neighborhoodSize: 3 }
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

test('memory ring rollover, consecutive matches, reset, and row-only scope retain their behavior', () => {
    const { subject } = createHarness({
        simulation: { algorithm: 'CA', states: 2 },
        grid: { baseDepth: 12 },
        initial: { mode: 'random' },
        ca: { rule: 'majority', neighborhoodSize: 1, cycleUniform: false }
    });
    subject.initialize();
    const memory = subject.memory;
    assert.equal(memory.capacity, 8);
    assert.equal(memory.compareLatestRow(), false);
    for (let z = 1; z < 12; z++) {
        subject.step();
        assert.equal(memory.latestConsecutiveRun.at(-1), z);
        assert.equal(memory.latestConsecutiveRun.length >= memory.matchRunLength, z >= 4);
    }
    assert.equal(memory.items.length, 8);
    assert.equal(memory.matchIndices.length, 8);
    assert.ok(memory.zIndices.every(z => z >= 4));
    subject.grid[1][1][11].state = 1;
    assert.equal(memory.hashRow(memory.extractRowStates(subject.grid, 11)),
        memory.hashes[memory.getLatestIndex(memory.items.length, memory.head)]);
    assert.equal(memory.findMatchingPastZIndices(memory.getLatestIndex(memory.items.length, memory.head)).length, 7);
    subject.initialize();
    assert.notEqual(subject.memory, memory);
    assert.equal(subject.memory.items.length, 1);
    assert.equal(subject.algorithm.ruleMap.size, 0);
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
        [{ memory: { capacityMultiplier: 0 } }, /capacityMultiplier/],
        [{ memory: { matchRunFraction: 0 } }, /matchRunFraction/],
        [{ simulation: { algorithm: 'CA' }, ca: { rule: 'bad' } }, /ca.rule/],
        [{ simulation: { algorithm: 'CA' }, ca: { neighborhoodSize: 2 } }, /must be odd/],
        [{ simulation: { algorithm: 'CA' }, ca: { neighborhoodSize: 0 } }, /neighborhoodSize/],
        [{ simulation: { algorithm: 'CA' }, ca: { cycleUniform: 'yes' } }, /cycleUniform/],
        [{ simulation: { algorithm: 'CA' }, ca: { rule: 'counts', emptyStateProbability: -1 } }, /emptyStateProbability/],
        [{ pn: { noiseSpaceScale: 0 } }, /noiseSpaceScale/],
        [{ pn: { noiseTimeScale: Infinity } }, /noiseTimeScale/],
        [{ view: { cameraPadding: 0.5 } }, /cameraPadding/]
    ]) {
        assert.throws(() => createHarness(overrides), message);
    }
    assert.doesNotThrow(() => createHarness({
        ca: { rule: 'bad', neighborhoodSize: 2, emptyStateProbability: -1 },
        initial: { mode: 'random', patternSize: -1, symmetry: 'bad', placement: 'bad', loopPattern: 'bad' },
        memory: { enabled: false, capacityMultiplier: -1, matchRunFraction: -1 }
    }));
    assert.doesNotThrow(() => createHarness({
        simulation: { algorithm: 'CA' }, ca: { emptyStateProbability: -1 },
        pn: { forwardProbability: -1, noiseSpaceScale: 0, noiseTimeScale: 0 }
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
