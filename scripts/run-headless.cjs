const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const ROOT = path.resolve(__dirname, '..');
const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function usage() {
    return 'Usage: npm run simulate:headless [-- --output <path.png>]';
}

function parseOutputPath(args) {
    if (args.length === 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return path.join(ROOT, 'output', `cellular_automata-${timestamp}.png`);
    }
    if (args.length !== 2 || args[0] !== '--output') {
        throw new Error(usage());
    }
    if (!args[1].toLowerCase().endsWith('.png')) {
        throw new Error('The output path must end in .png');
    }
    return path.resolve(process.cwd(), args[1]);
}

function createLocalServer() {
    return http.createServer((request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }

        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
            response.writeHead(400).end('Invalid URL');
            return;
        }
        if (pathname === '/') {
            pathname = '/index.html';
        }
        if (pathname === '/favicon.ico') {
            response.writeHead(204).end();
            return;
        }

        const filePath = path.resolve(ROOT, `.${pathname}`);
        if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
            response.writeHead(403).end('Forbidden');
            return;
        }

        fs.stat(filePath, (statError, stats) => {
            if (statError || !stats.isFile()) {
                response.writeHead(404).end('Not found');
                return;
            }
            response.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Length': stats.size,
                'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
            });
            if (request.method === 'HEAD') {
                response.end();
            } else {
                fs.createReadStream(filePath).pipe(response);
            }
        });
    });
}

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
}

async function closeServer(server) {
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

async function forwardConsoleMessage(message) {
    const type = message.type();
    if (!['log', 'info', 'warn', 'error'].includes(type)) {
        return;
    }
    const handles = message.args();
    const values = handles.length > 0
        ? await Promise.all(handles.map(handle => handle.jsonValue()))
        : [message.text()];
    console[type]('[Chromium]', ...values);
}

async function fitViewportToCanvas(page, dimensions) {
    const viewport = page.viewport();
    const width = Math.max(viewport?.width ?? 0, dimensions.width);
    const height = Math.max(viewport?.height ?? 0, dimensions.height);
    if (viewport && viewport.width === width && viewport.height === height) {
        return;
    }
    await page.setViewport({ ...viewport, width, height });
}

async function waitForSimulation(page, signal) {
    while (true) {
        signal?.throwIfAborted();
        const result = await page.evaluate(() => ({
            done: window.simulationDone === true,
            error: window.simulationError ?? null
        }));
        if (result.done || result.error !== null) {
            return result;
        }
        await delay(250, undefined, { signal });
    }
}

async function main() {
    const outputPath = parseOutputPath(process.argv.slice(2));
    const puppeteer = require('puppeteer');
    const server = createLocalServer();
    const startedAt = performance.now();
    let browser;

    try {
        await listen(server);
        const address = server.address();
        browser = await puppeteer.launch({
            headless: true,
            args: ['--enable-precise-memory-info']
        });
        const page = await browser.newPage();
        await page.exposeFunction('onSimulationProgress', progress => {
            const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
            const mib = bytes => (bytes / 1024 ** 2).toFixed(1);
            const heap = progress.heap;
            const memory = heap
                ? `${mib(heap.usedBytes)} MiB used / ${mib(heap.allocatedBytes)} MiB allocated / ${mib(heap.limitBytes)} MiB limit`
                : 'unavailable';
            console.log(`[Progress] ${progress.percent}% | ${progress.completed}/${progress.total} layers | ` +
                `${elapsed}s elapsed | Chromium JS heap: ${memory}`);
        });
        const consoleMessages = [];
        const pageFailure = new Promise((_, reject) => {
            page.once('pageerror', reject);
            page.once('error', reject);
            page.on('console', message => {
                const pending = forwardConsoleMessage(message);
                consoleMessages.push(pending);
                pending.catch(reject);
            });
        });
        page.on('response', response => {
            if (response.status() >= 400) {
                console.error(`[HTTP ${response.status()}] ${response.url()}`);
            }
        });
        console.log('Starting headless simulation...');
        const completion = new AbortController();
        const result = await Promise.race([
            (async () => {
                await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
                return waitForSimulation(page, completion.signal);
            })(),
            pageFailure
        ]).finally(() => completion.abort());
        await Promise.all(consoleMessages);
        if (result.error) {
            throw new Error(`Simulation failed:\n${result.error}`);
        }
        if (!result.done) {
            throw new Error('Chromium stopped before the simulation completed');
        }
        const canvas = await page.$('canvas');
        if (!canvas) {
            throw new Error('The simulation completed without creating a canvas');
        }
        const dimensions = await canvas.evaluate(element => ({
            width: element.width,
            height: element.height
        }));
        if (dimensions.width === 0 || dimensions.height === 0) {
            throw new Error('The simulation canvas has invalid dimensions');
        }
        await fitViewportToCanvas(page, dimensions);
        await page.evaluate(() => new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const image = await canvas.screenshot({ type: 'png' });
        await fsp.mkdir(path.dirname(outputPath), { recursive: true });
        await fsp.writeFile(outputPath, image, { flag: 'wx' });
        console.log(`Saved ${dimensions.width}x${dimensions.height} PNG to ${outputPath}`);
    } finally {
        if (browser) {
            await browser.close();
        }
        if (server.listening) {
            await closeServer(server);
        }
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { createLocalServer, fitViewportToCanvas, forwardConsoleMessage, waitForSimulation };
