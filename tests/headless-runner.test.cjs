const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const puppeteer = require('puppeteer');
const { createCanvas, loadImage } = require('canvas');
const { createLocalServer, fitViewportToCanvas, forwardConsoleMessage, waitForSimulation } =
    require('../scripts/run-headless.cjs');

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

    async function run(factor, seed = 123) {
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
            await page.evaluateOnNewDocument(({ factor, seed }) => {
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
                            parameterNoise: { spaceScale: 0.1, channels: 'shared' } } };
                    CONFIG.memory.enabled = false;
                    CONFIG.view.orientation = 'sideways';
                    CONFIG.view.presets.sideways.canvasScale = [1, 1];
                });
            }, { factor, seed });
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
