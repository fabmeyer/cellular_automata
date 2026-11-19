const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { createHarness } = require('./helpers.cjs');

function prepareSmallSimulation(numGenerations) {
    const { context, logs } = createHarness();
    const timers = [];
    const seeds = [];
    context.noise = () => 0;
    context.noiseSeed = seed => seeds.push(seed);
    context.setTimeout = callback => timers.push(callback);
    vm.runInContext(`
        Object.assign(CONFIG, {
            grid: { cols: 2, rows: 2, baseDepth: 2, cellSize: 1 },
            simulation: { ...CONFIG.simulation, algorithm: "PN", states: 2, numGenerations: ${numGenerations}, timeInterval: 0 },
            pn: { ...CONFIG.pn, mode: "legacy", boundary: "wrap", maxCellsPerAxisPerLayer: 1 },
            initial: { ...CONFIG.initial, mode: "random", resolutionFactor: 1 },
            memory: { ...CONFIG.memory, enabled: false },
            view: { ...CONFIG.view, orientation: "sideways" }
        });
        const OriginalGridRenderer = GridRenderer;
        GridRenderer = class extends OriginalGridRenderer {
            setup(onContextLost) { this.onContextLost = onContextLost; }
            assertContext() {}
            drawLayer() {}
        };
    `, context);
    return { context, timers, logs, seeds };
}

test('PN position startup logs movement units, shared slope, and the cell-size cap', () => {
    for (const mode of ['legacy', 'trajectory']) {
        const { context, logs } = prepareSmallSimulation(1);
        vm.runInContext(`
            CONFIG.grid.cellSize = 4;
            Object.assign(CONFIG.pn, { mode: '${mode}', movementUnit: 1, slope: [4, 4],
                trajectory: { slope: [99, 99], bend: [0, 0], amplitude: [0, 0],
                    wavelength: [16, 16], phase: [0, 0],
                    parameterNoise: { spaceScale: 0, channels: 'shared' } } });
            setup();
        `, context);
        const record = JSON.parse(logs.find(([label]) => label === 'Simulation settings:')[1]);
        assert.equal(record.algorithm.movementUnit, 1);
        assert.deepEqual(record.algorithm.slope, [4, 4]);
        assert.equal(record.algorithm.positionMode, true);
        assert.equal(record.algorithm.maxModelUnitsPerAxisPerLayer, 4);
        assert.equal(record.grid.cellSize, 4);
    }
});

test('startup logs configured and generated seeds without mutating configuration', () => {
    for (const [seed, source, expected] of [[0, 'configured', 0], [null, 'generated', 1073741824]]) {
        const { context, logs, seeds } = prepareSmallSimulation(1);
        vm.runInContext(`CONFIG.simulation.seed = ${seed}; Math.random = () => 0.25`, context);
        const before = Date.now();
        vm.runInContext('setup()', context);
        const after = Date.now();
        const records = logs.filter(([label]) => label === 'Simulation settings:');
        assert.equal(records.length, 1);
        const record = JSON.parse(records[0][1]);
        assert.equal(record.simulation.seed, expected);
        assert.equal(record.simulation.seedSource, source);
        assert.deepEqual(seeds, [expected]);
        assert.equal(vm.runInContext('CONFIG.simulation.seed', context), seed);
        assert.deepEqual(record.coloring, { state0Alpha: 0.05, otherStatesAlpha: 0.95 });
        assert.equal(record.grid.factor, 1);
        assert.equal(record.view.canvasWidth, 6);
        assert.equal(record.view.canvasHeight, 6);
        assert.deepEqual(record.memory, { enabled: false });
        assert.equal(record.algorithm.mode, 'legacy');
        assert.equal(Object.hasOwn(record.algorithm, 'trajectory'), false);
        assert.equal(Object.hasOwn(record, 'palette'), false);
        const timestamp = new Date(record.timestamp);
        assert.equal(timestamp.toISOString(), record.timestamp);
        assert.ok(timestamp.getTime() >= before && timestamp.getTime() <= after);
    }
});

test('startup logs effective factor-scaled PN settings and active memory thresholds', () => {
    const { context, logs } = prepareSmallSimulation(4);
    vm.runInContext(`
        CONFIG.grid = { factor: 4, cols: 8, rows: 8, baseDepth: 8, cellSize: 1 };
        CONFIG.simulation.seed = 7;
        CONFIG.coloring = { state0Alpha: 0.2, otherStatesAlpha: 0.3 };
        CONFIG.pn = { ...CONFIG.pn, mode: 'trajectory', noiseSpaceScale: 0.2, noiseTimeScale: 0.4,
            noiseDrift: [0.08, -0.12], noiseSteering: true,
            maxCellsPerAxisPerLayer: 10,
            trajectory: { slope: [0, 0], bend: [0, 0], amplitude: [1, 2], wavelength: [8, 16],
                phase: [0, 1], parameterNoise: { spaceScale: 0.12, channels: 'shared' } } };
        CONFIG.memory = { enabled: true, capacityMultiplier: 1, matchRunFraction: 0.5 };
    `, context);
    vm.runInContext('setup()', context);
    const record = JSON.parse(logs.find(([label]) => label === 'Simulation settings:')[1]);
    assert.equal(record.grid.factor, 4);
    assert.equal(record.initial.resolutionFactor, 4);
    assert.equal(record.simulation.numGenerations, 4);
    assert.equal(record.algorithm.noiseSpaceScale, 0.05);
    assert.equal(record.algorithm.noiseTimeScale, 0.1);
    assert.deepEqual(record.algorithm.noiseDrift, [0.02, -0.03]);
    assert.equal(record.algorithm.noiseSteering, true);
    assert.equal(record.algorithm.trajectory.parameterNoise.spaceScale, 0.03);
    assert.deepEqual(record.algorithm.trajectory.amplitude, [4, 8]);
    assert.deepEqual(record.algorithm.trajectory.wavelength, [32, 64]);
    assert.deepEqual(record.coloring, { state0Alpha: 0.2, otherStatesAlpha: 0.3 });
    assert.deepEqual(record.memory, {
        enabled: true, capacityMultiplier: 1, matchRunFraction: 0.5,
        capacity: 16, matchRunLength: 8, quarterDepth: 2, shortPeriodMatchRunLength: 2
    });
});

test('startup logs active CA settings and omits invalid inactive PN settings', () => {
    const { context, logs } = prepareSmallSimulation(1);
    vm.runInContext(`
        CONFIG.simulation.algorithm = 'CA';
        CONFIG.simulation.seed = 5;
        CONFIG.ca = { rule: 'majority', neighborhoodSize: 3, cycleUniform: true, emptyStateProbability: -1 };
        CONFIG.pn.noiseSpaceScale = -1;
    `, context);
    vm.runInContext('setup()', context);
    const record = JSON.parse(logs.find(([label]) => label === 'Simulation settings:')[1]);
    assert.equal(record.simulation.algorithm, 'CA');
    assert.deepEqual(record.algorithm, { rule: 'majority', neighborhoodSize: 3, cycleUniform: true });
    assert.deepEqual(record.coloring, { state0Alpha: 0.5, otherStatesAlpha: 1 });
});

test('headless completion is signaled only after the configured final generation', () => {
    const { context, timers } = prepareSmallSimulation(3);

    vm.runInContext('setup()', context);
    assert.equal(context.simulationDone, false);

    timers.shift()();
    assert.equal(context.simulationDone, false);
    timers.shift()();
    assert.equal(context.simulationDone, true);
    assert.equal(context.simulationError, null);
    assert.equal(vm.runInContext('simulation.grid.layers[0]', context), null);
});

test('glow runs once after all layers and before completion for CA and PN', () => {
    for (const algorithm of ['CA', 'PN']) {
        for (const generations of [1, 3]) {
            const { context, timers, logs } = prepareSmallSimulation(generations);
            const draws = [];
            context.captureGlow = (done, nextZ) => draws.push({ done, nextZ });
            vm.runInContext(`
                CONFIG.simulation.algorithm = '${algorithm}';
                CONFIG.view.glow = { enabled: true, cutoff: 0.9, radius: 16 };
                GridRenderer.prototype.applyGlow = function() {
                    captureGlow(globalThis.simulationDone, simulation.nextZ);
                };
                setup();
            `, context);
            if (generations > 1) assert.deepEqual(draws, []);
            while (timers.length > 0) timers.shift()();
            assert.deepEqual(draws, [{ done: false, nextZ: generations }]);
            assert.equal(context.simulationDone, true);
            vm.runInContext('renderer.finish()', context);
            assert.equal(draws.length, 1);
            const record = JSON.parse(logs.find(([label]) => label === 'Simulation settings:')[1]);
            assert.deepEqual(record.view.glow, { enabled: true, cutoff: 0.9, radius: 16, intensity: 1 });
        }
    }
});

test('glow failures never report completion in single or multi-layer runs', () => {
    for (const generations of [1, 3]) {
        const { context, timers } = prepareSmallSimulation(generations);
        vm.runInContext(`
            CONFIG.view.glow.enabled = true;
            GridRenderer.prototype.applyGlow = function() { throw new Error('glow failed'); };
        `, context);
        assert.throws(() => {
            vm.runInContext('setup()', context);
            while (timers.length > 0) timers.shift()();
        }, /glow failed/);
        assert.equal(context.simulationDone, false);
        assert.match(context.simulationError, /glow failed/);
    }
});

test('headless setup honors configured layer retention', () => {
    for (const retainHistory of [false, true]) {
        const { context, timers } = prepareSmallSimulation(3);
        vm.runInContext(`CONFIG.simulation.retainHistory = ${retainHistory}`, context);
        vm.runInContext('setup()', context);
        while (timers.length > 0) timers.shift()();

        assert.equal(context.simulationDone, true);
        assert.equal(vm.runInContext('simulation.grid.layers[0] !== null', context), retainHistory);
    }
});

test('context loss stops pending frames and clears completion after the final layer', () => {
    for (const generations of [1, 3]) {
        const { context, timers } = prepareSmallSimulation(generations);
        context.clearTimeout = () => {};
        context.console = { ...context.console, error() {} };
        vm.runInContext('setup()', context);
        const completed = vm.runInContext('simulation.nextZ', context);
        vm.runInContext('renderer.onContextLost(new Error("WebGL context lost"))', context);
        while (timers.length > 0) timers.shift()();
        assert.equal(vm.runInContext('simulation.nextZ', context), completed);
        assert.equal(context.simulationDone, false);
        assert.match(context.simulationError, /WebGL context lost/);
    }
});

test('context loss during the final draw cannot report successful completion', () => {
    const { context } = prepareSmallSimulation(1);
    context.console = { ...context.console, error() {} };
    vm.runInContext(`
        GridRenderer.prototype.drawLayer = function() {
            this.onContextLost(new Error("WebGL context lost during drawing"));
        };
    `, context);
    vm.runInContext('setup()', context);
    assert.equal(context.simulationDone, false);
    assert.match(context.simulationError, /context lost during drawing/);
});

test('headless completion is signaled for a single-layer simulation', () => {
    const { context, timers } = prepareSmallSimulation(1);
    const progress = [];
    context.onSimulationProgress = value => progress.push(value);

    vm.runInContext('setup()', context);

    assert.equal(context.simulationDone, true);
    assert.equal(timers.length, 0);
    assert.equal(progress.length, 1);
    assert.equal(progress[0].percent, 100);
    assert.equal(progress[0].heap, null);
});

test('headless progress reports rendered layers at each 10% milestone with browser heap usage', () => {
    const { context, timers } = prepareSmallSimulation(20);
    const progress = [];
    context.onSimulationProgress = value => progress.push(JSON.parse(JSON.stringify(value)));
    context.performance = {
        memory: { usedJSHeapSize: 1024, totalJSHeapSize: 2048, jsHeapSizeLimit: 4096 }
    };

    vm.runInContext('setup()', context);
    while (timers.length > 0) {
        timers.shift()();
    }

    assert.deepEqual(progress.map(value => value.percent), [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    assert.deepEqual(progress.find(value => value.percent === 50), {
        percent: 50, completed: 10, total: 20,
        heap: { usedBytes: 1024, allocatedBytes: 2048, limitBytes: 4096 }
    });
});

test('headless setup records validation failures before rethrowing them', () => {
    const { context, logs } = prepareSmallSimulation(1);
    vm.runInContext('CONFIG.simulation.states = 1', context);

    assert.throws(() => vm.runInContext('setup()', context), /between 2 and 9/);
    assert.match(context.simulationError, /between 2 and 9/);
    assert.equal(context.simulationDone, false);
    assert.equal(logs.some(([label]) => label === 'Simulation settings:'), false);
});
