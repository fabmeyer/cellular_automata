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
