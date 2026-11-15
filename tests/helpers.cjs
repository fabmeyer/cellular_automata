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
    const classes = vm.runInContext('({ Simulation, GridRenderer, RowMemory, StateGrid, wrapIndex, d4Representative, resolveConfig })',
        context);
    const defaults = structuredClone(vm.runInContext('CONFIG', context));
    const config = {
        ...defaults,
        grid: { ...defaults.grid, factor: 1, cols: 8, rows: 8, baseDepth: 8 },
        simulation: { ...defaults.simulation, retainHistory: true },
        pn: {
            ...defaults.pn, mode: 'legacy', boundary: 'wrap', maxCellsPerAxisPerLayer: 1,
            trajectory: {
                ...defaults.pn.trajectory, slope: [0, 0.5], bend: [0, 0],
                amplitude: [0, 0], wavelength: [32, 32], phase: [0, 2 * Math.PI]
            }
        },
        initial: { ...defaults.initial, patternSize: 2, resolutionFactor: 1 },
        view: { ...defaults.view, orientation: 'sideways' }
    };
    for (const [section, values] of Object.entries(overrides)) {
        config[section] = { ...config[section], ...values };
    }
    if (!Object.hasOwn(overrides.simulation ?? {}, 'numGenerations')) {
        config.simulation.numGenerations = config.grid.baseDepth *
            config.view.presets[config.view.orientation]?.depthMultiplier;
    }
    const subject = new classes.Simulation(config, random, noise);
    return { subject, config, classes, defaults, logs, context };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

// Nested [x][y] array of one layer's states, for readable assertions.
function layerStates(grid, z) {
    return Array.from({ length: grid.cols }, (_, x) => Array.from({ length: grid.rows }, (_, y) => grid.get(x, y, z)));
}

function seededRandom(seed = 123) {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
}

function drawingStub() {
    const calls = [];
    let canvas = new EventTarget();
    canvas.ownerDocument = {
        createElement() {
            const element = new EventTarget();
            element.ownerDocument = this;
            return element;
        }
    };
    const drawing = { WEBGL: 'WEBGL', height: 0, canvas };
    drawing.drawingContext = {
        canvas, MAX_TEXTURE_SIZE: 'texture', MAX_RENDERBUFFER_SIZE: 'renderbuffer',
        MAX_VIEWPORT_DIMS: 'viewport', NO_ERROR: 0,
        getParameter: name => name === 'viewport' ? [16384, 16384] : 16384,
        isContextLost: () => false,
        getError: () => 0,
        get drawingBufferWidth() { return canvas.width; },
        get drawingBufferHeight() { return canvas.height; }
    };
    for (const name of ['setAttributes', 'pixelDensity', 'createCanvas', 'resizeCanvas', 'camera', 'ortho', 'background', 'noLoop', 'noStroke', 'noLights',
        'ambientLight', 'push', 'pop', 'rotateX', 'rotateY', 'rotateZ', 'fill', 'translate', 'box']) {
        drawing[name] = (...args) => {
            calls.push([name, ...args]);
            if (name === 'createCanvas' && args[3]) {
                canvas = drawing.canvas = args[3];
                drawing.drawingContext.canvas = canvas;
            }
            if (name === 'createCanvas' || name === 'resizeCanvas') {
                drawing.width = canvas.width = args[0];
                canvas.height = args[1];
                drawing.height = args[1];
            }
            if (name === 'createCanvas') {
                return { elt: canvas };
            }
        };
    }
    return { drawing, calls };
}

module.exports = { createHarness, plain, layerStates, seededRandom, drawingStub };
