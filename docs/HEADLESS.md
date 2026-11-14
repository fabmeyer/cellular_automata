# Headless simulation and image export

The sketch uses p5.js `WEBGL` to render a 3D stack of cellular-automaton
generations. Puppeteer is used to run the existing page in headless Chromium and
save the final canvas as a PNG. This avoids a visible browser window and avoids
rewriting the renderer; it does **not** eliminate the browser process.

## Run it

Install the project dependencies once, then run the simulation:

```bash
npm install
npm run simulate:headless
```

By default, the final canvas is saved to a timestamped PNG under `output/`.
Provide an alternate path with:

```bash
npm run simulate:headless -- --output ./images/result.png
```

Output paths are resolved relative to the current working directory. The output
directory is created when necessary, and an existing file is never overwritten.
The output must have a `.png` extension.

The runner starts a temporary server bound to localhost, opens the existing
`index.html`, and uses the current [`sketch_3d/config.js`](../sketch_3d/config.js).
The sketch signals completion only after drawing the last configured
generation; the runner waits for that signal, allows the final frame to render,
expands Chromium's viewport to at least the canvas bitmap dimensions, captures
the canvas (not the whole page), writes the PNG, and exits. The viewport resize
prevents the page's CSS centering from placing a canvas larger than Chromium's
default viewport partly off-screen during capture. Simulation errors are
surfaced and do not produce a success-shaped image. There is no simulation
timeout; a long run continues until it completes or fails. The Node controller
checks completion using short browser status queries every 250 ms, rather than
holding one protocol request open for the entire simulation. Chromium's
per-command responsiveness deadline remains enabled.

## Progress and diagnostics

The CLI reports progress after the first rendered layer, whenever another 10%
threshold is crossed, and at 100%. Each line includes completed/total layers,
elapsed seconds, and Chromium's JavaScript heap usage:

```text
[Progress] 10% | 34/336 layers | 2.4s elapsed | Chromium JS heap: 42.0 MiB used / 64.0 MiB allocated / 4192.0 MiB limit
```

Percentages reflect whole rendered layers, including the initial layer. Small
runs can jump across several thresholds in one layer. The 100% update means
rendering has finished; the later `Saved ...` message confirms PNG export.

The runner enables Chromium's precise-memory reporting. Heap values mean
currently used JavaScript memory, allocated heap capacity, and the reported
heap ceiling, respectively. They are renderer statistics, **not** total
Chromium process RAM or GPU/native memory. Units are MiB (1,048,576 bytes). If
Chromium does not expose these statistics, the CLI explicitly reports them as
unavailable. The simulation's own "Memory repetition threshold" messages refer
to its row-history algorithm, not RAM pressure.

Structured browser console arguments are preserved instead of appearing as
`[object Object]`. Failed HTTP requests include their URL and status.
Chromium's automatic `/favicon.ico` lookup receives an empty 204 response, so
an absent optional icon does not produce a misleading 404. Other missing
assets still return 404 and remain visible.

### Long runs and "Waiting failed"

The original completion wait used `waitForFunction({ timeout: 0 })`. Although
that disables Puppeteer's wait timeout, the underlying Chrome DevTools Protocol
request still had a separate 180-second default deadline. A healthy simulation
running longer than that could fail with `Waiting failed`, hiding a
`Runtime.callFunctionOn timed out` cause. This is not a JavaScript heap-limit
error.

Completion is now polled from Node with short requests, so total simulation
duration does not consume one command's deadline. Page errors and renderer
crashes still stop the run; outstanding completion polling is cancelled during
cleanup. CLI errors include their stack and nested cause instead of only the
outer message. A genuinely unresponsive individual browser command can still
reach its protocol deadline, which is intentionally not disabled globally.

## Memory limits

Puppeteer controls Chromium; it does not turn the page into a Node.js
computation. `node --max-old-space-size=...` changes the Node process heap, not
the separate Chromium renderer's heap.

Chromium accepts V8 options through `--js-flags`, but testing the installed
Chromium with `--max_old_space_size=4096` and `8192` reported the same
JavaScript heap limit as the default: `3,760,000,000` bytes. That historical
measurement is not a universal limit: reported values depend on the runtime
and measurement precision, so use the live CLI output for the current run.
The runner does not pass a heap-size override that did not increase the
measured limit. Its precise-memory flag only improves reporting; it does not
raise the heap ceiling. Chromium's
pointer-compression heap constraint is discussed in the
[Chromium issue tracker](https://issues.chromium.org/issues/41133247). This
JavaScript heap limit is not the same as the Mac's total RAM, and increasing a
V8 option cannot bypass Chromium's per-isolate limit.

The active configuration at the time this workflow was set up uses a
192-by-192 grid and 1,344 generations. That means about 49.5 million allocated
grid slots and layer-cell draw operations, plus a 3,072-by-6,144 canvas. The
full configuration was verified end to end after fixing the completion wait:
one run completed all layers and exported the PNG in approximately 497 seconds,
well beyond the former 180-second protocol cutoff. Its completion sample
reported 1,675 MiB of used JavaScript heap against a 4,192 MiB reported limit.
These are measurements from one random run, not resource guarantees or peak
memory measurements. Larger or different settings may still exceed Chromium
or WebGL resource limits.

If a full run exceeds the renderer's capacity, larger Chromium heap flags are
not a reliable remedy. The next options are to reduce or compact the retained
simulation data, or move computation into a Node.js process and adapt the final
rendering step. A browser-free renderer would require replacing or adapting the
current WebGL rendering path.

## Validation notes

The headless completion/error tests pass with:

```bash
node --test tests/headless-completion.test.cjs tests/headless-runner.test.cjs
```

At setup time, the full `npm test` suite had pre-existing failures where tests
assumed different simulation configuration defaults. For example, a test
expected 576 generations while the active settings produced 672. The active
configuration was left intact, and these unrelated expectation failures were
not changed as part of the headless setup.
