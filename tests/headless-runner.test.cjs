const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const puppeteer = require('puppeteer');
const { createCanvas, loadImage } = require('canvas');
const { createLocalServer, fitViewportToCanvas, forwardConsoleMessage, waitForSimulation } =
    require('../scripts/run-headless.cjs');

test('final glow matches Gaussian pixels, cutoff boundaries, and the exported PNG', async t => {
    const server = createLocalServer();
    t.after(() => new Promise(resolve => server.close(resolve)));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
        window.addEventListener('DOMContentLoaded', () => {
            CONFIG.grid = { factor: 1, cols: 2, rows: 2, baseDepth: 1, cellSize: 1 };
            CONFIG.simulation = { ...CONFIG.simulation, algorithm: 'CA', states: 2, numGenerations: 1 };
            CONFIG.initial = { mode: 'random', resolutionFactor: 1 };
            CONFIG.memory.enabled = false;
            CONFIG.view.orientation = 'sideways';
            CONFIG.view.antialias = false;
            CONFIG.view.presets.sideways = {
                depthMultiplier: 1, canvasScale: [32, 32], rotation: [0, 0, 0]
            };
            CONFIG.view.glow = { enabled: false, cutoff: 0.9, radius: 16 };
        });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.simulationDone || window.simulationError);
    await page.addStyleTag({ content: 'canvas { border: 0; }' });
    const run = options => page.evaluate(options => {
        if (window.simulationError) throw new Error(window.simulationError);
        const gl = renderer.gl;
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        gl.enable(gl.SCISSOR_TEST);
        for (const [x, y, w, h, color] of [
            [0, 0, width, height, [10, 12, 14]],
            [20, 23, 9, 7, options.color],
            [0, 3, 5, 6, options.color]
        ]) {
            gl.scissor(x, y, w, h);
            gl.clearColor(...color.map(value => value / 255), 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.disable(gl.SCISSOR_TEST);
        const read = () => {
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return Array.from(pixels);
        };
        const before = read();
        renderer.settings.view.glow = options;
        renderer.finished = false;
        renderer.finish();
        const after = read();
        renderer.finish();
        return { before, after, repeated: read(), width, height, error: gl.getError() };
    }, options);
    for (const options of [
        { enabled: false, cutoff: 0.9, radius: 16, color: [255, 40, 20] },
        { enabled: true, cutoff: 0.9, radius: 3, color: [229, 40, 20] },
        { enabled: true, cutoff: 230 / 255, radius: 3, color: [230, 40, 20] },
        { enabled: true, cutoff: 1, radius: 3, color: [255, 255, 255] },
        { enabled: true, cutoff: 0.9, radius: 3, color: [230, 40, 20] },
        { enabled: true, cutoff: 0, radius: 3, color: [20, 40, 255] },
        ...[0, 0.5, 1, 2].map(intensity =>
            ({ enabled: true, cutoff: 0.9, radius: 3, intensity, color: [255, 40, 20] })),
        ...[1, 3, 8, 16].map(radius =>
            ({ enabled: true, cutoff: 0.9, radius, color: [255, 40, 20] }))
    ]) {
        const result = await run(options);
        assert.equal(result.error, 0);
        assert.deepEqual(result.repeated, result.after, 'finish must not add glow twice');
        const { width, height, before, after } = result;
        const intensity = options.intensity ?? 1;
        const generatesGlow = options.enabled && intensity > 0 &&
            Math.max(...options.color) / 255 > options.cutoff;
        if (!generatesGlow) {
            assert.deepEqual(after, before, JSON.stringify(options));
            continue;
        }
        const radius = options.radius;
        const weights = Array.from({ length: radius * 2 + 1 },
            (_, i) => Math.exp(-4.5 * ((i - radius) / radius) ** 2));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        const horizontal = new Float64Array(before.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (x + dx < 0 || x + dx >= width) continue;
                    const source = (y * width + x + dx) * 4;
                    if (Math.max(...before.slice(source, source + 3)) / 255 <= options.cutoff) continue;
                    for (let c = 0; c < 3; c++) {
                        horizontal[(y * width + x) * 4 + c] +=
                            before[source + c] * weights[dx + radius] / total;
                    }
                }
            }
        }
        let changed = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                for (let c = 0; c < 3; c++) {
                    let glow = 0;
                    for (let dy = -radius; dy <= radius; dy++) {
                        if (y + dy < 0 || y + dy >= height) continue;
                        glow += horizontal[((y + dy) * width + x) * 4 + c] * weights[dy + radius] / total;
                    }
                    const expected = Math.min(255, Math.round(before[index + c] + intensity * glow));
                    const tolerance = Math.max(1, Math.ceil((intensity + 1) / 2));
                    assert.ok(Math.abs(after[index + c] - expected) <= tolerance,
                        `radius=${radius}, intensity=${intensity}, (${x},${y}), channel=${c}: ` +
                        `${after[index + c]} vs ${expected}`);
                    assert.ok(after[index + c] >= before[index + c], 'original image must not darken');
                    if (after[index + c] !== before[index + c]) changed++;
                    if (glow === 0) assert.equal(after[index + c], before[index + c]);
                }
                assert.equal(after[index + 3], before[index + 3]);
            }
        }
        assert.ok(changed > 0);
        const canvasElement = await page.$('canvas');
        const image = await loadImage(Buffer.from(await canvasElement.screenshot({ type: 'png' })));
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const png = context.getImageData(0, 0, width, height).data;
        for (let y = 0; y < height; y++) {
            assert.deepEqual(Array.from(png.slice(y * width * 4, (y + 1) * width * 4)),
                after.slice((height - y - 1) * width * 4, (height - y) * width * 4));
        }
    }
    assert.deepEqual(errors, []);
});

test('CA and PN complete glow before signaling export readiness', async t => {
    const server = createLocalServer();
    t.after(() => new Promise(resolve => server.close(resolve)));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    for (const algorithm of ['CA', 'PN']) {
        for (const generations of [1, 3]) {
            const page = await browser.newPage();
            await page.evaluateOnNewDocument(({ algorithm, generations }) => {
                window.addEventListener('DOMContentLoaded', () => {
                    CONFIG.grid = { factor: 1, cols: 2, rows: 2, baseDepth: 2, cellSize: 1 };
                    CONFIG.simulation = { ...CONFIG.simulation, algorithm, states: 2,
                        numGenerations: generations, timeInterval: 0 };
                    CONFIG.pn = { ...CONFIG.pn, mode: 'legacy', slope: [0, 0] };
                    CONFIG.initial = { mode: 'random', resolutionFactor: 1 };
                    CONFIG.memory.enabled = false;
                    CONFIG.view.orientation = 'sideways';
                    CONFIG.view.presets.sideways = {
                        depthMultiplier: 1, canvasScale: [8, 8], rotation: [0, 0, 0]
                    };
                    CONFIG.view.background = 255;
                    CONFIG.view.glow = { enabled: true, cutoff: 0.9, radius: 3 };
                });
            }, { algorithm, generations });
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            await page.waitForFunction(() => window.simulationDone || window.simulationError);
            const result = await page.evaluate(() => ({
                done: window.simulationDone, error: window.simulationError,
                finished: renderer.finished, nextZ: simulation.nextZ
            }));
            assert.deepEqual(result, { done: true, error: null, finished: true, nextZ: generations });
            await page.close();
        }
    }
});

test('PN position instancing renders one-unit shifts with unchanged 4/8-unit footprints', async t => {
    const server = createLocalServer();
    t.after(() => new Promise(resolve => server.close(resolve)));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const run = async (mode, size) => {
        const page = await browser.newPage();
        try {
            await page.evaluateOnNewDocument(({ mode, size }) => {
                window.addEventListener('DOMContentLoaded', () => {
                    CONFIG.grid = { factor: 1, cols: 4, rows: 4, baseDepth: 1, cellSize: size };
                    CONFIG.simulation = { ...CONFIG.simulation, algorithm: 'PN', seed: 123,
                        states: 2, numGenerations: 1, retainHistory: true };
                    CONFIG.pn = { ...CONFIG.pn, mode, movementUnit: 1, slope: [1, 1],
                        noiseSteering: false, forwardProbability: 1, maxCellsPerAxisPerLayer: 1,
                        trajectory: { slope: [99, 99], bend: [0, 0], amplitude: [0, 0],
                            wavelength: [16, 16], phase: [0, 0],
                            parameterNoise: { spaceScale: 0, channels: 'shared' } } };
                    CONFIG.initial = { ...CONFIG.initial, mode: 'random', resolutionFactor: 1 };
                    CONFIG.memory.enabled = false;
                    CONFIG.coloring = { state0Alpha: 0, otherStatesAlpha: 1 };
                    CONFIG.view.orientation = 'sideways';
                    CONFIG.view.cameraPadding = 1;
                    CONFIG.view.antialias = false;
                    CONFIG.view.presets.sideways = { depthMultiplier: 1, canvasScale: [4, 4], rotation: [0, 0, 0] };
                });
            }, { mode, size });
            await page.goto(origin);
            await page.waitForFunction(() => window.simulationDone || window.simulationError);
            return await page.evaluate(size => {
                if (window.simulationError) throw new Error(window.simulationError);
                simulation = new Simulation({ ...CONFIG,
                    simulation: { ...CONFIG.simulation, numGenerations: 3 } });
                simulation.initialize();
                simulation.grid.layer(0).clear();
                simulation.grid.set(size, size, 0, 1);
                simulation.algorithm.initialize(simulation.grid);
                simulation.algorithm.history.set(`${size},${size}`, [1, 0]);
                simulation.algorithm.trajectories.get(`${size},${size}`).direction = [1, 0];
                renderer.colors = ['rgba(0, 0, 0, 0)', 'rgb(255, 0, 0)'];
                renderer.instancing = renderer.createInstancing();
                const gl = renderer.gl;
                const bounds = z => {
                    background(10);
                    renderer.drawLayer(simulation.grid, z);
                    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
                    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
                        gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (let y = 0; y < gl.drawingBufferHeight; y++) {
                        for (let x = 0; x < gl.drawingBufferWidth; x++) {
                            const i = (y * gl.drawingBufferWidth + x) * 4;
                            if (pixels[i] > 200 && pixels[i + 1] < 50 && pixels[i + 2] < 50) {
                                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                                minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                            }
                        }
                    }
                    return { minX, maxX, minY, maxY };
                };
                const initial = bounds(0);
                simulation.step();
                const moved = bounds(1);
                return {
                    initial, moved, sparse: renderer.instancing.sparse,
                    width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
                    state: [...simulation.grid.layer(1).values()],
                    error: gl.getError(), image: gl.canvas.toDataURL()
                };
            }, size);
        } finally {
            await page.close();
        }
    };
    for (const mode of ['legacy', 'trajectory']) {
        for (const size of [4, 8]) {
            const result = await run(mode, size);
            assert.equal(result.sparse, true);
            assert.equal(result.error, 0);
            assert.equal(result.width, 16 * size);
            assert.equal(result.height, 16 * size);
            assert.equal(result.initial.maxX - result.initial.minX + 1, 4 * size);
            assert.deepEqual(result.moved, { ...result.initial,
                minX: result.initial.minX + 4, maxX: result.initial.maxX + 4 });
            assert.deepEqual(result.state, [{ x: size + 1, y: size, state: 1 }]);
            assert.deepEqual(await run(mode, size), result);
        }
    }
});

test('the optional favicon does not produce a 404, but missing assets still do', async t => {
    const server = createLocalServer();
    t.after(() => new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;

    const favicon = await fetch(`${origin}/favicon.ico`);
    assert.equal(favicon.status, 204);
    const missing = await fetch(`${origin}/missing-script.js`);
    assert.equal(missing.status, 404);
});

test('HTTP launch serves the sketch and local Safari locale without CDN fallback', async t => {
    const server = createLocalServer();
    t.after(() => new Promise(resolve => server.close(resolve)));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const resource of ['/', '/sketch_3d/sketch_1d_3d.js', '/en-GB.json', '/de-DE.json']) {
        const response = await fetch(`${origin}${resource}`);
        assert.equal(response.status, 200);
        if (resource.endsWith('.json')) {
            assert.match(response.headers.get('content-type'), /application\/json/);
            assert.deepEqual(await response.json(), {});
        } else {
            await response.arrayBuffer();
        }
    }
});

test('Chromium console arguments preserve diagnostic objects', async t => {
    const messages = [];
    t.mock.method(console, 'log', (...args) => messages.push(args));
    const diagnostic = { speedBound: 0.5, configuredLimit: 1 };

    await forwardConsoleMessage({
        type: () => 'log',
        args: () => [
            { jsonValue: async () => 'Movement bound:' },
            { jsonValue: async () => diagnostic }
        ]
    });

    assert.deepEqual(messages, [['[Chromium]', 'Movement bound:', diagnostic]]);
});

test('Chromium resource errors without console arguments are still reported', async t => {
    const messages = [];
    t.mock.method(console, 'error', (...args) => messages.push(args));

    await forwardConsoleMessage({
        type: () => 'error',
        args: () => [],
        text: () => 'Failed to load resource'
    });

    assert.deepEqual(messages, [['[Chromium]', 'Failed to load resource']]);
});

test('Chromium forwarding retains complete parseable startup JSON', async t => {
    const messages = [];
    t.mock.method(console, 'log', (...args) => messages.push(args));
    const record = { simulation: { seed: 0 }, algorithm: { trajectory: { amplitude: [4, 8] } } };
    await forwardConsoleMessage({
        type: () => 'log',
        args: () => [
            { jsonValue: async () => 'Simulation settings:' },
            { jsonValue: async () => JSON.stringify(record) }
        ]
    });
    assert.deepEqual(messages[0].slice(0, 2), ['[Chromium]', 'Simulation settings:']);
    assert.deepEqual(JSON.parse(messages[0][2]), record);
});

test('seeded browser runs repeat at factors 1 and 4 with aligned initial patterns and colors', async t => {
    const forwarded = [];
    t.mock.method(console, 'log', (...args) => forwarded.push(args));
    const server = createLocalServer();
    t.after(() => new Promise(resolve => server.close(resolve)));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());

    async function run(factor, seed = 123, pn = {}) {
        const page = await browser.newPage();
        const records = [];
        const pending = [];
        page.on('console', message => {
            const text = message.text();
            const prefix = 'Simulation settings: ';
            if (text.startsWith(prefix)) {
                records.push(JSON.parse(text.slice(prefix.length)));
                pending.push(forwardConsoleMessage(message));
            }
        });
        try {
            await page.evaluateOnNewDocument(({ factor, seed, pn }) => {
                window.addEventListener('DOMContentLoaded', () => {
                    CONFIG.grid = { factor, cols: 4 * factor, rows: 4 * factor,
                        baseDepth: 4 * factor, cellSize: 2 };
                    CONFIG.simulation = { ...CONFIG.simulation, algorithm: 'PN', states: 3, seed,
                        numGenerations: 3 * factor, retainHistory: true, timeInterval: 0 };
                    CONFIG.initial = { ...CONFIG.initial, mode: 'random', resolutionFactor: 1 };
                    CONFIG.pn = { ...CONFIG.pn, mode: 'trajectory', boundary: 'wrap',
                        forwardProbability: 1, maxCellsPerAxisPerLayer: 10,
                        trajectory: { slope: [0.25, 0.25], bend: [0, 0], amplitude: [0, 0],
                            wavelength: [4, 4], phase: [0, 0],
                            parameterNoise: { spaceScale: 0.1, channels: 'shared' } },
                        ...pn };
                    CONFIG.memory.enabled = false;
                    CONFIG.view.orientation = 'sideways';
                    CONFIG.view.presets.sideways.canvasScale = [1, 1];
                });
            }, { factor, seed, pn });
            await page.goto(origin);
            await page.waitForFunction(() => window.simulationDone || window.simulationError, { timeout: 30000 });
            const result = await page.evaluate(() => {
                if (window.simulationError) throw new Error(window.simulationError);
                return {
                    layers: simulation.grid.layers.map(layer => Array.from(layer)),
                    colors: renderer.colors,
                    noiseSample: noise(0.25, 0.5, 0.75),
                    width: renderer.gl.canvas.width,
                    height: renderer.gl.canvas.height,
                    image: renderer.gl.canvas.toDataURL()
                };
            });
            await Promise.all(pending);
            assert.equal(records.length, 1);
            return { ...result, record: records[0] };
        } finally {
            await page.close();
        }
    }

    const base = await run(1);
    const refined = await run(4);
    function withoutTimestamp(result) {
        const { timestamp, ...record } = result.record;
        assert.equal(new Date(timestamp).toISOString(), timestamp);
        return { ...result, record };
    }
    assert.deepEqual(withoutTimestamp(await run(1)), withoutTimestamp(base));
    assert.deepEqual(withoutTimestamp(await run(4)), withoutTimestamp(refined));
    assert.deepEqual(refined.colors, base.colors);
    assert.equal(refined.noiseSample, base.noiseSample);
    assert.equal(refined.width, base.width * 4);
    assert.equal(refined.height, base.height * 4);
    assert.equal(base.record.simulation.seedSource, 'configured');
    assert.equal(refined.record.grid.factor, 4);
    for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
            assert.equal(refined.layers[0][(x * 4) * 16 + y * 4], base.layers[0][x * 4 + y]);
        }
    }
    const generated = await run(1, null);
    assert.equal(generated.record.simulation.seedSource, 'generated');
    assert.ok(Number.isInteger(generated.record.simulation.seed));
    const replay = await run(1, generated.record.simulation.seed);
    assert.equal(replay.record.simulation.seedSource, 'configured');
    for (const key of ['layers', 'colors', 'noiseSample', 'width', 'height', 'image']) {
        assert.deepEqual(replay[key], generated[key], key);
    }
    const records = forwarded.filter(([prefix, label]) =>
        prefix === '[Chromium]' && label === 'Simulation settings:');
    assert.equal(records.length, 6);
    assert.deepEqual(JSON.parse(records[4][2]), generated.record);
    assert.deepEqual(JSON.parse(records[5][2]), replay.record);
    for (const mode of ['legacy', 'trajectory']) {
        const pn = {
            mode, noiseSpaceScale: 0.2, noiseTimeScale: 0, noiseDrift: [0.4, 0.4],
            noiseSteering: true, maxCellsPerAxisPerLayer: 1,
            trajectory: { slope: [0.5, 1], bend: [0, 0], amplitude: [0, 0],
                wavelength: [16, 16], phase: [0, 0],
                parameterNoise: { spaceScale: 0.2, channels: 'separate' } }
        };
        const sliding = await run(1, 123, pn);
        assert.deepEqual(withoutTimestamp(await run(1, 123, pn)), withoutTimestamp(sliding));
        const stationary = await run(1, 123, { ...pn, noiseDrift: [0, 0] });
        assert.deepEqual(sliding.layers[0], stationary.layers[0]);
        assert.notDeepEqual(sliding.layers.slice(1), stationary.layers.slice(1), mode);
        assert.equal(sliding.record.algorithm.noiseSteering, true);
        assert.deepEqual(sliding.record.algorithm.noiseDrift, [0.4, 0.4]);
    }
});

test('GridRenderer applies antialiasing to the p5 WebGL context', async t => {
    const server = createLocalServer();
    t.after(() => new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;

    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    for (const antialias of [true, false]) {
        const page = await browser.newPage();
        await page.setContent(`
            <script src="${origin}/js/p5.js"></script>
            <script src="${origin}/sketch_3d/config.js"></script>
            <script src="${origin}/sketch_3d/renderer.js"></script>
            <script>
                CONFIG.grid.factor = 1;
                CONFIG.view.orientation = 'sideways';
                CONFIG.view.presets.sideways.canvasScale = [1, 1];
                CONFIG.view.antialias = ${antialias};
                window.setupResult = null;
                const settings = resolveConfig(CONFIG);
                new p5(p => {
                    p.setup = () => {
                        try {
                            new GridRenderer(settings, p).setup();
                            window.setupResult = {
                                antialias: p._renderer.GL.getContextAttributes().antialias
                            };
                        } catch (error) {
                            window.setupResult = { error: error.message };
                        }
                    };
                });
            </script>
        `);
        await page.waitForFunction(() => window.setupResult !== null);
        assert.deepEqual(await page.evaluate(() => window.setupResult), { antialias });
        await page.close();
    }
});

test('HTTP sketch honors history settings, keeps exact dimensions at both densities and reports context loss', async t => {
    const server = createLocalServer();
    t.after(() => new Promise(resolve => server.close(resolve)));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());

    for (const [deviceScaleFactor, language, canvasWidth, canvasHeight, retainHistory] of [
        [1, 'en-GB', 5000, 32, false],
        [2, 'de-DE', 6144, 12288, true]
    ]) {
        const page = await browser.newPage();
        const errors = [];
        const failures = [];
        const responses = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('requestfailed', request => failures.push(request.url()));
        page.on('response', response => responses.push([response.url(), response.status()]));
        await page.setViewport({ width: 800, height: 600, deviceScaleFactor });
        await page.evaluateOnNewDocument(({ language, canvasWidth, canvasHeight, retainHistory }) => {
            Object.defineProperty(navigator, 'language', { get: () => language });
            localStorage.clear();
            window.addEventListener('DOMContentLoaded', () => {
                CONFIG.grid = { cols: 2, rows: 2, baseDepth: 2, cellSize: 1 };
                CONFIG.simulation = {
                    ...CONFIG.simulation, algorithm: 'PN', states: 2, numGenerations: 3, timeInterval: 0, retainHistory
                };
                CONFIG.pn.mode = 'legacy';
                CONFIG.pn.boundary = 'wrap';
                CONFIG.initial.mode = 'random';
                CONFIG.memory.enabled = false;
                CONFIG.view.orientation = 'sideways';
                CONFIG.view.presets.sideways.canvasScale = [canvasWidth / 2, canvasHeight / 2];
            });
        }, { language, canvasWidth, canvasHeight, retainHistory });
        const localeResponse = page.waitForResponse(response => response.url() === `${origin}/${language}.json`);
        await page.goto(origin, { waitUntil: 'load' });
        await localeResponse;
        await page.waitForFunction(() => window.simulationDone || window.simulationError);
        assert.deepEqual(await page.evaluate(() => ({
            error: window.simulationError, density: pixelDensity(),
            width: drawingContext.drawingBufferWidth, height: drawingContext.drawingBufferHeight,
            canvasWidth: drawingContext.canvas.width, canvasHeight: drawingContext.canvas.height,
            antialias: drawingContext.getContextAttributes().antialias, canvases: document.querySelectorAll('canvas').length,
            firstLayerRetained: simulation.grid.layers[0] !== null
        })), { error: null, density: 1, width: canvasWidth, height: canvasHeight,
            canvasWidth, canvasHeight, antialias: true, canvases: 1, firstLayerRetained: retainHistory });
        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
        assert.ok(responses.some(([url, status]) => url === `${origin}/${language}.json` && status === 200));
        assert.ok(!responses.some(([url]) => url.includes('/extracted.json')));
        if (deviceScaleFactor === 1) {
            await fitViewportToCanvas(page, { width: 5000, height: 32 });
            const canvas = await page.$('canvas');
            const image = await loadImage(Buffer.from(await canvas.screenshot({ type: 'png' })));
            assert.equal(image.width, 5000);
            assert.equal(image.height, 32);
        }

        assert.equal(await page.evaluate(() => {
            const extension = drawingContext.getExtension('WEBGL_lose_context');
            if (!extension) return false;
            extension.loseContext();
            return true;
        }), true);
        await page.waitForFunction(() => window.simulationError !== null);
        assert.equal(await page.evaluate(() => window.simulationDone), false);
        assert.match(await page.evaluate(() => window.simulationError), /WebGL context lost/);
        assert.ok(!errors.some(message => /shaderSource|initializing the shader/.test(message)));
        await page.close();
    }
});

test('canvas screenshots retain both edges when the canvas exceeds the browser viewport', async t => {
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`
        <style>
            * { margin: 0; padding: 0; border: 1px solid black; box-sizing: border-box; }
            body { display: flex; justify-content: center; align-items: center;
                min-height: 100vh; background: #f0f0f0; }
        </style>
        <canvas width="1536" height="3072" style="width: 1536px; height: 3072px"></canvas>
    `);
    const canvas = await page.$('canvas');
    await canvas.evaluate(element => {
        const context = element.getContext('2d');
        context.fillStyle = '#ff0000';
        context.fillRect(0, 0, 384, element.height);
        context.fillStyle = '#000000';
        context.fillRect(384, 0, 768, element.height);
        context.fillStyle = '#0000ff';
        context.fillRect(1152, 0, 384, element.height);
    });

    await fitViewportToCanvas(page, { width: 1536, height: 3072 });
    const png = await canvas.screenshot({ type: 'png' });
    const image = await loadImage(Buffer.from(png));
    const decoded = createCanvas(image.width, image.height);
    const context = decoded.getContext('2d');
    context.drawImage(image, 0, 0);

    assert.deepEqual([image.width, image.height], [1536, 3072]);
    assert.deepEqual(Array.from(context.getImageData(20, 100, 1, 1).data), [255, 0, 0, 255]);
    assert.deepEqual(Array.from(context.getImageData(1515, 100, 1, 1).data), [0, 0, 255, 255]);
});

test('simulation waits outlive the protocol deadline and still report simulation errors', async t => {
    const browser = await puppeteer.launch({ headless: true, protocolTimeout: 1000 });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`
        <script>
            window.simulationDone = false;
            window.simulationError = null;
            setTimeout(() => { window.simulationDone = true; }, 2000);
        </script>
    `);

    assert.deepEqual(await waitForSimulation(page), { done: true, error: null });

    await page.setContent(`
        <script>
            window.simulationDone = false;
            window.simulationError = null;
            setTimeout(() => { window.simulationError = 'drawing failed'; }, 100);
        </script>
    `);
    assert.deepEqual(await waitForSimulation(page), { done: false, error: 'drawing failed' });
});
