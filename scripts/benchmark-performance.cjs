const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const puppeteer = require('puppeteer');
const { createLocalServer } = require('./run-headless.cjs');

// Research harness: never starts the full, potentially multi-gigabyte default run.
async function main() {
    const root = path.resolve(__dirname, '..');
    const server = createLocalServer();
    let browser;
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--enable-precise-memory-info', '--js-flags=--expose-gc']
        });
        const page = await browser.newPage();
        page.on('console', message => {
            if (['error', 'warn'].includes(message.type())) console.error(message.text());
        });
        await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 2 });
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (request.isNavigationRequest()) {
                const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
                    .replace('<script src="sketch_3d/sketch_1d_3d.js"></script>',
                        '<script>function setup() { noLoop(); }</script>');
                void request.respond({ contentType: 'text/html', body: html });
            } else {
                void request.continue();
            }
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => typeof createCanvas === 'function');
        await page.addScriptTag({
            content: fs.readFileSync(path.join(root, 'sketch_3d/sketch_1d_3d.js'), 'utf8')
                .replace('function setup()', 'function unusedSketchSetup()')
        });
        const result = await page.evaluate(async () => {
            noiseSeed(123);
            const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
            const randomGenerator = () => {
                let seed = 123;
                return () => {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    return seed / 2 ** 32;
                };
            };
            const defaults = structuredClone(CONFIG);
            const native = resolveConfig(defaults);
            function configFor(size, generations, algorithm = 'PN') {
                return {
                    ...defaults,
                    grid: { ...defaults.grid, cols: size, rows: size, baseDepth: generations },
                    simulation: { ...defaults.simulation, numGenerations: generations, algorithm },
                    initial: { ...defaults.initial, patternSize: Math.min(size, 32) },
                    view: { ...defaults.view, orientation: 'sideways' }
                };
            }
            const glInfo = createCanvas(32, 32, WEBGL).drawingContext;
            const debug = glInfo.getExtension('WEBGL_debug_renderer_info');
            const environment = {
                p5: p5.VERSION,
                userAgent: navigator.userAgent,
                dpr: devicePixelRatio,
                renderer: debug ? glInfo.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
                maxTextureSize: glInfo.getParameter(glInfo.MAX_TEXTURE_SIZE),
                maxRenderbufferSize: glInfo.getParameter(glInfo.MAX_RENDERBUFFER_SIZE),
                maxViewport: Array.from(glInfo.getParameter(glInfo.MAX_VIEWPORT_DIMS)),
                heapLimit: performance.memory?.jsHeapSizeLimit
            };
            const rendering = [];
            for (const size of [48, 192]) {
                const sim = new Simulation(configFor(size, 8), randomGenerator(), noise);
                sim.initialize();
                for (const density of size === 48 ? [1, 2] : [1]) {
                    const drawing = Object.create(globalThis);
                    Object.defineProperty(drawing, 'createCanvas', {
                        value: (...args) => {
                            const canvas = createCanvas(...args);
                            pixelDensity(density);
                            return canvas;
                        }
                    });
                    const renderer = new GridRenderer(sim.settings, drawing, randomGenerator());
                    renderer.setup();
                    const gl = drawingContext;
                    const readback = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
                    const sample = operation => {
                        background(sim.settings.view.background);
                        gl.finish();
                        const start = performance.now();
                        operation();
                        gl.finish();
                        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
                            gl.RGBA, gl.UNSIGNED_BYTE, readback);
                        const duration = performance.now() - start;
                        const error = gl.getError();
                        if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
                        return duration;
                    };
                    const clearReadbackMs = sample(() => {});
                    sample(() => renderer.drawLayer(sim.grid, 0));
                    const immediate = Array.from({ length: 5 }, () =>
                        sample(() => renderer.drawLayer(sim.grid, 0)));
                    const row = {
                        size, density,
                        pixels: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                        boxes: size * size,
                        clearReadbackMs,
                        immediateMs: immediate,
                        immediateMedianMs: median(immediate)
                    };
                    if (size === 48 && density === 1) {
                        sample(() => renderer.drawLayer(sim.grid, 0));
                        const before = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
                        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
                            gl.RGBA, gl.UNSIGNED_BYTE, before);
                        const buildTimes = [];
                        const drawTimes = [];
                        let geometry;
                        for (let i = 0; i < 5; i++) {
                            if (geometry) freeGeometry(geometry);
                            const start = performance.now();
                            geometry = buildGeometry(() => renderer.drawLayer(sim.grid, 0));
                            buildTimes.push(performance.now() - start);
                            drawTimes.push(sample(() => model(geometry)));
                        }
                        const after = new Uint8Array(before.length);
                        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
                            gl.RGBA, gl.UNSIGNED_BYTE, after);
                        let changedChannels = 0;
                        let maximumDifference = 0;
                        for (let i = 0; i < before.length; i++) {
                            const difference = Math.abs(before[i] - after[i]);
                            if (difference) changedChannels++;
                            maximumDifference = Math.max(maximumDifference, difference);
                        }
                        Object.assign(row, {
                            buildTimes, drawTimes,
                            buildMedianMs: median(buildTimes), drawMedianMs: median(drawTimes),
                            pixelComparison: { changedChannels, totalChannels: before.length, maximumDifference }
                        });
                        freeGeometry(geometry);
                    }
                    if (density === 1) {
                        sample(() => renderer.drawLayer(sim.grid, 0));
                        const before = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
                        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
                            gl.RGBA, gl.UNSIGNED_BYTE, before);
                        let foregroundPixels = 0;
                        for (let i = 0; i < before.length; i += 4) {
                            if (before[i] !== before[0] || before[i + 1] !== before[1] ||
                                before[i + 2] !== before[2]) foregroundPixels++;
                        }
                        if (foregroundPixels < 100) throw new Error('Benchmark image is blank');
                        row.foregroundPixels = foregroundPixels;
                        const stateImage = createImage(size, size);
                        stateImage.loadPixels();
                        for (let x = 0; x < size; x++) {
                            for (let y = 0; y < size; y++) {
                                const offset = (x * size + y) * 4;
                                stateImage.pixels[offset] = sim.grid.get(x, y, 0);
                                stateImage.pixels[offset + 3] = 255;
                            }
                        }
                        stateImage.updatePixels();
                        const palette = renderer.colors.flatMap(value => {
                            const values = value.match(/[\d.]+/g).map(Number);
                            return [values[0] / 255, values[1] / 255,
                                values[2] / 255, values[3] ?? 1];
                        });
                        const instancedShader = createShader(`#version 300 es
                            precision highp float;
                            precision highp int;
                            in vec3 aPosition;
                            uniform mat4 uModelViewMatrix;
                            uniform mat4 uProjectionMatrix;
                            uniform sampler2D states;
                            uniform int side;
                            uniform float cellSize;
                            uniform float depth;
                            uniform vec4 palette[9];
                            flat out vec4 cellColor;
                            void main() {
                                int x = gl_InstanceID / side;
                                int y = gl_InstanceID % side;
                                int state = int(round(texelFetch(states, ivec2(y, x), 0).r * 255.0));
                                cellColor = palette[state];
                                vec3 offset = vec3(
                                    (float(x) - float(side) / 2.0 + 0.5) * cellSize,
                                    (float(y) - float(side) / 2.0 + 0.5) * cellSize,
                                    (0.5 - depth / 2.0) * cellSize);
                                gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition + offset, 1.0);
                            }`, `#version 300 es
                            precision highp float;
                            flat in vec4 cellColor;
                            out vec4 outColor;
                            void main() { outColor = vec4(cellColor.rgb * cellColor.a, cellColor.a); }`);
                        const cube = buildGeometry(() => box(sim.settings.grid.cellSize));
                        const drawInstanced = () => {
                            stateImage.updatePixels();
                            push();
                            noStroke();
                            fill(255, 128);
                            const [rx, ry, rz] = sim.settings.preset.rotation;
                            rotateX(Math.PI * rx);
                            rotateY(Math.PI * ry);
                            rotateZ(Math.PI * rz);
                            shader(instancedShader);
                            instancedShader.setUniform('states', stateImage);
                            instancedShader.setUniform('side', size);
                            instancedShader.setUniform('cellSize', sim.settings.grid.cellSize);
                            instancedShader.setUniform('depth', sim.settings.depth);
                            instancedShader.setUniform('palette', palette);
                            model(cube, size * size);
                            pop();
                            resetShader();
                        };
                        sample(drawInstanced);
                        const times = Array.from({ length: 5 }, () => sample(drawInstanced));
                        const after = new Uint8Array(before.length);
                        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
                            gl.RGBA, gl.UNSIGNED_BYTE, after);
                        let changedChannels = 0;
                        let maximumDifference = 0;
                        for (let i = 0; i < before.length; i++) {
                            const difference = Math.abs(before[i] - after[i]);
                            if (difference) changedChannels++;
                            maximumDifference = Math.max(maximumDifference, difference);
                        }
                        row.instancing = {
                            times, medianMs: median(times),
                            pixelComparison: { changedChannels, totalChannels: before.length, maximumDifference }
                        };
                        freeGeometry(cube);
                    }
                    rendering.push(row);
                }
            }
            const simulation = [];
            for (const algorithm of ['PN', 'CA']) {
                for (const rolling of [false, true]) {
                    const samples = [];
                    const checksums = [];
                    for (let trial = 0; trial < 4; trial++) {
                        const sim = new Simulation(configFor(96, 64, algorithm),
                            randomGenerator(), noise);
                        sim.initialize();
                        const start = performance.now();
                        let z;
                        let checksum = 0;
                        while ((z = sim.step()) !== null) {
                            for (let x = 0; x < 96; x++) {
                                for (let y = 0; y < 96; y++) {
                                    checksum = (Math.imul(checksum, 31) + sim.grid.get(x, y, z)) >>> 0;
                                }
                            }
                            if (rolling) sim.grid.layers[z - 1] = null;
                            for (const cell of sim.grid.outsideLayers?.[z]?.values() ?? []) {
                                for (const value of [cell.x, cell.y, cell.state]) {
                                    checksum = (Math.imul(checksum, 31) + value) >>> 0;
                                }
                            }
                            if (rolling && sim.grid.outsideLayers) {
                                sim.grid.outsideLayers[z - 1] = null;
                            }
                        }
                        if (trial > 0) {
                            samples.push(performance.now() - start);
                            checksums.push(checksum);
                        }
                    }
                    simulation.push({ algorithm, rolling, samples, medianMs: median(samples), checksums });
                }
            }
            const memory = [];
            for (const kind of ['objects', 'uint8']) {
                const before = await new Promise(resolve => setTimeout(() => {
                    gc();
                    resolve(performance.memory.usedJSHeapSize);
                }, 75));
                const start = performance.now();
                let storage;
                if (kind === 'objects') {
                    storage = Array.from({ length: 96 }, (_, x) =>
                        Array.from({ length: 96 }, (_, y) =>
                            Array.from({ length: 128 }, (_, z) => ({ x: x * 4, y: y * 4, z, state: z % 9 }))));
                } else {
                    storage = new Uint8Array(96 * 96 * 128);
                    for (let i = 0; i < storage.length; i++) storage[i] = i % 9;
                }
                const allocationMs = performance.now() - start;
                globalThis.benchmarkStorage = storage;
                gc();
                await new Promise(resolve => setTimeout(resolve, 75));
                memory.push({
                    kind, cells: 96 * 96 * 128, allocationMs,
                    heapDeltaBytes: performance.memory.usedJSHeapSize - before,
                    backingBytes: kind === 'uint8' ? storage.byteLength : 0
                });
                delete globalThis.benchmarkStorage;
                storage = null;
                gc();
            }
            const scheduling = [];
            for (const count of [64, 256]) {
                const start = performance.now();
                for (let i = 0; i < count; i++) {
                    await new Promise(resolve => setTimeout(resolve, 1));
                }
                scheduling.push({ count, elapsedMs: performance.now() - start });
            }
            const backingStores = Array.from({ length: 272 }, () => {
                const bytes = new Uint8Array(16 * 1024 ** 2);
                bytes[0] = 123;
                return bytes;
            });
            const largeBackingStoreProbe = {
                logicalBytes: backingStores.reduce((sum, bytes) => sum + bytes.byteLength, 0),
                touchedBytes: backingStores.length,
                allReadable: backingStores.every(bytes => bytes[0] === 123),
                note: 'Virtual/logical allocation only; not a physical RAM stress test.'
            };
            let webgpu;
            if (navigator.gpu) {
                const adapter = await navigator.gpu.requestAdapter();
                webgpu = adapter ? {
                    info: { ...adapter.info.toJSON?.() },
                    maxBufferSize: adapter.limits.maxBufferSize,
                    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
                    maxTextureDimension2D: adapter.limits.maxTextureDimension2D
                } : { adapter: null };
            } else {
                webgpu = { available: false };
            }
            return {
                environment, rendering, simulation, memory, scheduling, webgpu, largeBackingStoreProbe,
                defaultWorkload: {
                    cols: native.grid.cols, rows: native.grid.rows, depth: native.depth,
                    generations: native.simulation.numGenerations,
                    cells: native.grid.cols * native.grid.rows * native.simulation.numGenerations,
                    canvas: [native.canvasWidth, native.canvasHeight]
                }
            };
        });
        await page.close();
        const oldP5Control = await benchmarkModernP5(browser, server.address().port, root, false);
        const modernP5 = await benchmarkModernP5(browser, server.address().port, root, true);
        console.log(JSON.stringify({
            date: new Date().toISOString(),
            host: { cpu: os.cpus()[0].model, ramBytes: os.totalmem(), node: process.version },
            browser: await browser.version(),
            modernP5,
            oldP5Control,
            ...result
        }, null, 2));
    } finally {
        if (browser) await browser.close();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
}

async function benchmarkModernP5(browser, port, root, modern) {
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (request.isNavigationRequest()) {
                const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
                    .replace('src="js/p5.js"', modern ? 'src="node_modules/p5/lib/p5.js"' : 'src="js/p5.js"')
                    .replace('</head>', modern ?
                        '<script src="node_modules/p5/lib/p5.webgpu.js"></script></head>' : '</head>')
                    .replace('<script src="sketch_3d/sketch_1d_3d.js"></script>',
                        '<script>function setup() { noLoop(); }</script>');
                void request.respond({ contentType: 'text/html', body: html });
            } else {
                void request.continue();
            }
        });
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(() => typeof createCanvas === 'function');
        await page.addScriptTag({
            content: fs.readFileSync(path.join(root, 'sketch_3d/sketch_1d_3d.js'), 'utf8')
                .replace('function setup()', 'function unusedSketchSetup()')
        });
        return await page.evaluate(async modern => {
            const config = structuredClone(CONFIG);
            config.grid.cols = 48;
            config.grid.rows = 48;
            config.grid.baseDepth = 8;
            config.simulation.numGenerations = 8;
            config.view.orientation = 'sideways';
            noiseSeed(123);
            let seed = 123;
            const random = () => {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return seed / 2 ** 32;
            };
            const sim = new Simulation(config, random, noise);
            sim.initialize();
            const results = [];
            for (const mode of modern ? [WEBGL, WEBGPU] : [WEBGL]) {
                const isWebGPU = mode === 'webgpu';
                const canvas = await createCanvas(sim.settings.canvasWidth, sim.settings.canvasHeight, mode);
                pixelDensity(1);
                const drawing = Object.create(globalThis);
                Object.defineProperty(drawing, 'createCanvas', { value: () => canvas });
                // This comparison measures the per-cell path; the instanced GLSL shader cannot run on WebGPU.
                Object.defineProperty(drawing, 'createShader', { value: undefined });
                seed = 123;
                const renderer = new GridRenderer(sim.settings, drawing, random);
                renderer.setup();
                const times = [];
                for (let trial = 0; trial < 6; trial++) {
                    background(sim.settings.view.background);
                    const start = performance.now();
                    renderer.drawLayer(sim.grid, 0);
                    if (isWebGPU) {
                        await canvas.finishDraw();
                        await canvas.device.queue.onSubmittedWorkDone();
                    }
                    await loadPixels();
                    if (trial > 0) times.push(performance.now() - start);
                }
                let foregroundPixels = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                    if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] ||
                        pixels[i + 2] !== pixels[2]) foregroundPixels++;
                }
                if (foregroundPixels < 100) throw new Error('Modern p5 benchmark image is blank');
                results.push({
                    version: p5.VERSION, mode, size: 48, times,
                    medianMs: [...times].sort((a, b) => a - b)[2],
                    foregroundPixels,
                    deviceLimits: isWebGPU ? {
                        maxBufferSize: canvas.device.limits.maxBufferSize,
                        maxStorageBufferBindingSize: canvas.device.limits.maxStorageBufferBindingSize,
                        maxTextureDimension2D: canvas.device.limits.maxTextureDimension2D
                    } : null
                });
            }
            return results;
        }, modern);
    } finally {
        await page.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
