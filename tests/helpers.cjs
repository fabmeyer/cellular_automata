const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const scripts = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .matchAll(/<script src="(sketch_3d\/[^"]+)"><\/script>/g)]
    .map(([, file]) => ({ file, source: fs.readFileSync(path.join(root, file), 'utf8') }));

function createHarness(overrides = {}, { random = () => 0, noise = () => 0 } = {}) {
    const logs = [];
    const context = vm.createContext({ console: { log(...args) { logs.push(args); } } });
    for (const { file, source } of scripts) {
        vm.runInContext(source, context, { filename: file });
    }
    const classes = vm.runInContext('({ Simulation, GridRenderer, RowMemory, wrapIndex, d4Representative, resolveConfig })',
        context);
    const defaults = structuredClone(vm.runInContext('CONFIG', context));
    const config = {
        ...defaults,
        grid: { ...defaults.grid, cols: 8, rows: 8, baseDepth: 8 },
        pn: {
            ...defaults.pn, mode: 'legacy', maxCellsPerAxisPerLayer: 1,
            trajectory: {
                ...defaults.pn.trajectory, slope: [0, 0.5], bend: [0, 0],
                amplitude: [0, 0], wavelength: [32, 32], phase: [0, 2 * Math.PI]
            }
        },
        initial: { ...defaults.initial, patternSize: 2 },
        view: { ...defaults.view, orientation: 'sideways' }
    };
    for (const [section, values] of Object.entries(overrides)) {
        config[section] = { ...config[section], ...values };
    }
    const subject = new classes.Simulation(config, random, noise);
    return { subject, config, classes, defaults, logs };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function seededRandom(seed = 123) {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
}

function drawingStub() {
    const calls = [];
    const drawing = { WEBGL: 'WEBGL', height: 0 };
    for (const name of ['createCanvas', 'camera', 'ortho', 'background', 'noLoop', 'noStroke', 'noLights',
        'ambientLight', 'push', 'pop', 'rotateX', 'rotateY', 'rotateZ', 'fill', 'translate', 'box']) {
        drawing[name] = (...args) => {
            calls.push([name, ...args]);
            if (name === 'createCanvas') {
                drawing.height = args[1];
            }
        };
    }
    return { drawing, calls };
}

module.exports = { createHarness, plain, seededRandom, drawingStub };
