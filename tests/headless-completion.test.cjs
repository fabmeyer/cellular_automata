const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { createHarness } = require('./helpers.cjs');

function prepareSmallSimulation(numGenerations) {
    const { context } = createHarness();
    const timers = [];
    context.noise = () => 0;
    context.setTimeout = callback => timers.push(callback);
    vm.runInContext(`
        Object.assign(CONFIG, {
            grid: { cols: 2, rows: 2, baseDepth: 2, cellSize: 1 },
            simulation: { algorithm: "PN", states: 2, numGenerations: ${numGenerations}, timeInterval: 0 },
            pn: { ...CONFIG.pn, mode: "legacy", boundary: "wrap", maxCellsPerAxisPerLayer: 1 },
            initial: { ...CONFIG.initial, mode: "random" },
            memory: { ...CONFIG.memory, enabled: false },
            view: { ...CONFIG.view, orientation: "sideways" }
        });
        GridRenderer = class {
            setup() {}
            drawLayer() {}
        };
    `, context);
    return { context, timers };
}

test('headless completion is signaled only after the configured final generation', () => {
    const { context, timers } = prepareSmallSimulation(3);

    vm.runInContext('setup()', context);
    assert.equal(context.simulationDone, false);

    timers.shift()();
    assert.equal(context.simulationDone, false);
    timers.shift()();
    assert.equal(context.simulationDone, true);
    assert.equal(context.simulationError, null);
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
    const { context } = prepareSmallSimulation(1);
    vm.runInContext('CONFIG.simulation.states = 1', context);

    assert.throws(() => vm.runInContext('setup()', context), /between 2 and 9/);
    assert.match(context.simulationError, /between 2 and 9/);
    assert.equal(context.simulationDone, false);
});
