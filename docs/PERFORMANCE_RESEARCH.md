# sketch_3d performance and large-image research

Researched and benchmarked locally on 2026-11-14.

## Executive conclusion

**Keep p5 initially: use instanced cubes, compact state, and bounded history.**
The largest measured rendering improvement was **53.4x for one 192x192 layer**,
using the repository's existing p5 2.1.2/WebGL and a custom instancing shader.
This is not a measured whole-simulation speedup.

**WebGPU is not automatically faster.** p5 2.4.0 WebGPU was **31.6% slower**
than p5 2.4.0 WebGL for this sketch's existing per-cell drawing pattern in the
small test. A raw WebGPU/Vite implementation is promising for instancing,
compute, and tiled exports, but its runtime speedup has not been measured.

**The approximately 4 GiB limit is not a total-RAM limit.** Compact/chunked
ArrayBuffers, GPU resources, or Node-side simulation can exceed that boundary.
Large images also require tiling: more RAM cannot raise a texture's maximum
dimensions.

Production simulation/rendering files were not changed. The new
[benchmark harness](../scripts/benchmark-performance.cjs) contains isolated
research prototypes; [raw measurements](./PERFORMANCE_RESULTS.json) preserve
the actual samples.

## 1. What this repository actually does

- [The page](../index.html) loads **vendored p5 2.1.2**, not the installed npm
  p5 2.4.0. Updating package.json alone does not update the running sketch.
- [The renderer](../sketch_3d/renderer.js) issues
  `push/fill/translate/box/pop` for **every** interior cell, including state 0,
  and then for occupied outside cells.
- Empty cubes are **not invisible**: PN alpha is 0.05; occupied PN alpha is
  0.95. CA empties have alpha 0.5. Skipping zero states, removing internal
  faces, sorting geometry, or switching to opaque voxels can change the image.
- [The grid](../sketch_3d/grid.js) preallocates nested arrays for all generations,
  then retains a separate `{x,y,z,state}` Cell for every interior voxel.
- Both algorithms read the previous layer. [RowMemory](../sketch_3d/memory.js)
  already copies the one stripe it needs. Historical outside PN maps are
  retained, although stepping needs only the previous one.
- [The frame loop](../sketch_3d/sketch_1d_3d.js) already draws each layer once;
  it does **not** redraw the whole volume every frame. Avoiding such a redraw
  would therefore not be an improvement here.
- Current local settings resolve to **192x192x1344 = 49,545,216 interior
  cells**, effective camera depth 768, and a **3072x6144 logical canvas**.
  At pixel density 2 its physical backing becomes 6144x12288.

## 2. Measurement method and limits

Hardware: Apple M4 Pro, 24 GiB shared system/GPU RAM, macOS arm64.
Runtime: Node 26.12.1, Puppeteer 25.17.0, Chrome 157.0.8103.50,
ANGLE/Metal hardware rendering. No software-renderer flags were used.

Reproduce from the repository root:

```sh
node scripts/benchmark-performance.cjs > docs/PERFORMANCE_RESULTS.json
```

The harness uses the actual local configuration, seeded p5 noise and random
initialization, and actual repository classes. It suppresses automatic startup
to avoid running the full large default volume.

- Rendering: first layer, five samples after warm-up, median reported.
  48x48 and 192x192 planes; sideways view and eight-layer camera depth.
  WebGL measurements include full RGBA readback to synchronize actual work,
  not just JavaScript command submission. Setup/compilation is excluded.
- The instancing prototype updates a small state texture on every draw,
  preserves x/y submission order, and uses the existing translucent palette.
  It does not yet support grown outside cells or full-volume replay.
- For the version/backend comparison, both p5 versions use the same
  `loadPixels()` timing path, 48x48 input, 576x576 physical output,
  pixel density 1, and five timed samples. WebGPU explicitly finishes
  submission and waits for submitted GPU work before readback.
- Simulation: 96x96, 64 generations, three samples after warm-up, no rendering.
  Timings include state checksumming and, in the bounded-history variant,
  clearing old references. Checksums include PN outside cells.
- Allocation: one 1,179,648-cell storage experiment, not a complete simulation.
  Do not treat its allocation-time speedup as a timestep speedup.
- No complete 1344-layer run, large physical-memory stress test, or final
  large PNG export was benchmarked. Results can vary with thermal load,
  browser version, scene density, transparency, canvas size, and hardware.

### Rendering correctness checks

Images were checked to contain foreground geometry, not just a cleared canvas.
Instancing matched **every channel** at 48x48. At 192x192, **94 of 21,233,664
channels differed**, with maximum channel difference 58/255. Thus this prototype
is **not certified pixel-identical** at the larger size; floating-point
transform/rasterization differences need investigation before a production
replacement. Retained geometry matched every channel in its 48x48 test.
WebGPU had a slightly different foreground footprint and was not certified
pixel-identical either.

## 3. Nine concrete options

Numbers below are **measured**, **analytic**, or explicitly **unmeasured**.
Their speedups cannot be multiplied together: they optimize overlapping work.

| Option | Performance result for this repository | Memory / image consequence |
|---|---|---|
| **1. Instanced cubes in the existing p5/WebGL renderer** | **Measured:** 192x192: **416.6 -> 7.8 ms/layer, 53.4x**. 48x48: **28.3 -> 1.4 ms, 20.2x**. One shared cube and state texture replace thousands of per-cell submissions. | Reuse cube geometry; derive regular-grid coordinates from instance ID. A packed dense state needs 1 byte/cell on CPU, or typically 4 bytes/cell in a simple GPU storage layout. Browser heap cap remains; GPU allocations are separate. |
| **2. Actually load npm p5 2.4.0, staying on WebGL** | **Measured controlled comparison:** **26.0 -> 17.4 ms, 1.49x**, on 48x48 with unchanged per-cell renderer. | No increase in JS heap or texture caps. Low implementation effort, but repeat regression/image tests before upgrading. |
| **3. Replace Cell objects/nested histories with flat Uint8Array state** | **Measured allocation only:** **32.1 -> 3.1 ms, 10.35x** for 1,179,648 cells. Reported allocation delta: **37,772,608 -> 1,185,300 bytes, 31.9x smaller**. | States are 0..8: one byte is sufficient. Coordinates can be derived. Current 49,545,216-cell dense state becomes exactly **47.25 MiB**, excluding other structures. Chunked backing stores can cross 4 GiB in aggregate. |
| **4. Keep two working layers; release/archive old data** | **Measured reference-release prototype:** PN **222.9 -> 212.5 ms, 1.049x**; CA **107.6 -> 102.8 ms, 1.047x**, over 63 steps. Matching checksums in all trials. Small short-run time improvement; principal benefit is memory. | **Analytic full redesign:** dense uint8 working state **47.25 MiB -> 72 KiB, 672x smaller**, for 1344 -> 2 planes. PN outside maps/trajectory metadata and stripe memory are additional. |
| **5. p5.js WebGPU, retaining the per-cell loop** | **Measured:** p5 2.4 WebGPU **22.9 ms**, versus old 2.1.2 WebGL **26.0 ms: 1.14x**. But modern 2.4 WebGL is **17.4 ms**, so WebGPU is **31.6% slower than simply upgrading WebGL** in this case. | Stock tested p5 WebGPU device uses **256 MiB max buffer, 128 MiB max storage binding, 8192 texture side** despite higher adapter capabilities. It does not remove the JS heap cap. |
| **6. Raw WebGPU in a Vite application** | **Unmeasured:** no defensible whole-repository speedup yet. **Analytic:** instancing reduces 36,864 interior cube submissions/layer to roughly one draw/layer. Existing-WebGL instancing already realizes the main draw-call opportunity. Vite alone has no demonstrated runtime gain. | Can explicitly request higher adapter limits, use compact buffers, GPU compute, and tiled readback. Local adapter advertises **4,294,967,292 bytes per buffer/storage binding** and **16384 texture side**; total GPU budget is separate and not guaranteed. |
| **7. Tiled rendering + streaming export** | Not a speed optimization by itself. A 50,000-square image with 4096-square tiles needs **169 tile views**; replaying the whole scene for each can approach 169x rendering work without tile culling. | **Analytic:** 50,000-square RGBA8 needs **9.31 GiB** just for color, versus **64 MiB per 4096 tile**. Removes the need for one giant canvas/texture and one full-image RAM allocation. |
| **8. Batch layer scheduling in offline mode** | **Measured:** 256 nested `setTimeout(...,1)` waits cost **1148.2 ms** without simulation. **Analytic extrapolation:** the default 1343 transitions can spend approximately **6.0 seconds** in timer waiting; batching can avoid most of that overhead, not the rendering itself. | No heap-cap change. Bound each batch and yield for progress/cancellation/watchdog responsiveness. Keep the existing paced mode for interactive use. |
| **9. Explicit pixel density for export** | **Measured:** density 2 -> 1 was only **28.6 -> 28.3 ms, 1.01x**, at 48x48: this scene is CPU-submission-bound. No evidence of a 4x frame-time improvement. | **Analytic:** halves each physical dimension and cuts color/depth pixel storage **4x**. On the default logical canvas, RGBA8 backing falls **288 -> 72 MiB**. This changes output resolution unless logical dimensions are adjusted. |

### Important implementation qualifications

**Instancing:** the vendored 2.1.2 already supports `model(geometry, count)`
and GLSL `gl_InstanceID`; no upgrade or WebGPU is required for option 1.
The benchmark preserves submission order rather than imposing a new
transparency sort. Grown PN cells require an additional packed coordinate
buffer/batch, in existing order. A layer's CPU state can be discarded after it
has been drawn into a persistent accumulation target.

**Compact history:** the reference-release prototype still leaves preallocated
history slots in place; achieving the 672x dense-state saving requires a real
ring-buffer redesign, not merely assigning null. For tiling, camera changes,
or WebGPU device/context recovery, archive compact history/instance data or
save deterministic checkpoints. The normal application uses Math.random,
so replay requires explicitly recording/seeding all randomness and noise.

**Retained geometry is not the first choice for this one-shot renderer.**
At 48x48, a cached merged model draws in **9.0 ms instead of 28.3 ms (3.14x)**,
but building it takes **39.8 ms**. Build + first draw is approximately
**48.8 ms, 1.72x slower** than drawing that layer once directly. It also
duplicates cube vertices. Useful for repeated views; avoid baking the whole
49.5-million-cell volume into p5 JavaScript geometry.

**Compute shaders:** CA is the easier first target. The sum rule's 3x3,
nine-state weighted sums have only **73 possible keys (0..72)**, but
cycleUniform and stripe-driven mutations must still be preserved. Current
random rules are assigned lazily in encounter order, so parallel assignment
would change the result unless that ordering is reproduced. PN trajectory
collisions, ordered merges, float sin/truncation, unbounded outward
coordinates, and noise parity make a faithful PN compute port harder.
No CA/PN compute speedup is claimed without implementing and testing it.

## 4. Memory caps: measured limits versus budgets

| Resource | Local result / documented limit | What it means |
|---|---|---|
| Chromium JS object heap | Reported limit **4,395,630,592 B = 4192 MiB** | This is not a 4 GiB cap on all process/system memory. Ordinary Cell objects remain subject to the V8 heap/cage constraint. |
| Chunked browser ArrayBuffers | **4.25 GiB logical backing allocated and readable**, using 272 x 16 MiB arrays | Only one byte per chunk was deliberately touched. This proves allocation beyond 4 GiB in aggregate, **not 4.25 GiB of resident physical RAM** or a maximum. |
| Node heap on this installed build | Pointer compression **0**; `node --max-old-space-size=8192` reports **8288 MiB total heap limit** | The old-space setting is 8 GiB; total heap includes other spaces. No multi-GiB object-allocation stress test was run here. |
| Local WebGL texture/renderbuffer/viewport side | **16384** | An upper resource-dimension limit, not a guarantee that a 16384-square canvas/export will succeed. |
| Tested stock p5 WebGPU device | Buffer **256 MiB**, storage binding **128 MiB**, texture side **8192** | Observed device defaults. Installed add-on calls requestDevice without requiredLimits. |
| Local WebGPU adapter | Buffer and storage binding **4 GiB minus 4 B**, texture side **16384** | Advertised capability, not a successful maximum-size allocation test. A raw port must request limits and handle allocation failure. |
| Total CPU/GPU memory | Host has **24 GiB shared RAM** | No universal usable per-tab/GPU budget. OS, browser, other users/processes, and driver consume it. Do not promise all 24 GiB to the sketch. |

The 4.25 GiB probe is intentionally non-destructive in this shared environment.
The existing [Chromium memory investigation](./CHROMIUM_MEMORY.md), which was
present before this task and was not edited, reports earlier larger physical
allocation experiments; those are not relabeled as new measurements here.

The allocation table's `heapDeltaBytes` is the change in Chromium's
`performance.memory.usedJSHeapSize` counter, which may account for backing
stores. **Do not add backingBytes to it or use it to identify exact in-cage
heap usage.** The one-byte state payload is independently known from byteLength.
The object sample implies roughly 32 bytes/interior cell at this scale:
approximately **1.48 GiB for current dense history**, before PN outside cells,
Map strings, trajectories, palette, p5 geometry, and temporary allocations.
That is an extrapolation, not a peak-memory measurement of the full run.

### How to use more than 4 GiB responsibly

1. Keep bulk state in modest-size typed-array chunks, not millions of Cells
   or string-keyed objects. Keep total backing bytes separately instrumented.
2. Upload/download in chunks. Neither the 256 MiB default GPU buffer limit
   nor the 128 MiB binding limit is a total GPU-memory limit.
3. If simulation needs a large object heap, move it into this installed Node
   build and configure old space explicitly. The existing Puppeteer runner's
   Node heap setting does **not** enlarge the page's Chromium heap.
4. Stream archives/export rows to disk. A native wgpu renderer is another
   possible offline architecture, but was not prototyped or benchmarked here.
5. Do not count on workers to multiply a browser's object-heap budget.
   Workers are mainly responsiveness/parallelism tools; process/cage sharing
   and transfer/copy behavior need separate verification.

## 5. Bigger images: recommended architecture

For **50,000x50,000** or larger exports:

1. Run simulation once; retain packed states/instances on disk or in chunks.
2. Keep the existing camera framing and draw order. Render 4096x4096 tiles
   using off-axis orthographic bounds, not unrelated tile cameras.
3. Render all contributing layers into each tile in their original order.
   Cull only primitives outside that tile's projected coverage.
4. Stream tile rows through a Node-side PNG encoder. A row is only
   **200,000 bytes** at width 50,000; a 4096-row full-width band is
   **781.25 MiB**, if band assembly is used instead.
5. Do not stitch into a giant HTML canvas, full-image Buffer, or PNG base64
   string. That would reintroduce the allocation problem.

A non-MSAA 4096 tile with RGBA8 color, depth32, and CPU RGBA readback requires
approximately **192 MiB of raw attachment/readback storage**; p5/driver
allocations, encoder workspace, additional staging, and MSAA are extra.
MSAA color/depth attachments substantially increase this budget.
These are byte calculations, not a measured working-set bound.

WebGPU texture-to-buffer copies also require row-stride alignment to 256 bytes.
4096x4 naturally meets it; other widths may need padding. A 50,000-square
export is architecturally feasible with tiling, but has **not** been exported
or timed in this task.

## 6. Recommended order and validation gates

1. **Upgrade the actually loaded p5, then implement WebGL instancing.**
   Benchmark them separately; inspect the 94 differing channels first.
2. **Compact state and bounded working history**, including grown PN data.
   Compare complete layer states, collision metadata, stripe events, and
   mutations, not only final screenshots/checksums.
3. **Add a tiled, streaming offline export path**; verify tile seams and
   transparency against a small monolithic render before increasing size.
4. Prototype **raw WebGPU compute + instancing** only after these baselines.
   Vite can organize/bundle that application, but does not itself solve
   draw-call overhead, heap layout, or texture dimensions.

Do not silently remove alpha, skip state 0, cull interior faces, reorder
transparent geometry, change blend/depth state, or lower resolution while
claiming unchanged output.

Validation in this task: benchmark completed and produced real foreground
images; benchmark syntax check passed. Existing repository tests were also
run: **64 passed, 28 failed** in the starting configuration. No application
source/test file was modified to mask or fix those unrelated failures.

## 7. Primary sources

Retrieved 2026-11-14; moving documentation may change after this date.
Repository-specific findings above come from the linked local source and
raw benchmark, not external performance claims.

- **p5 releases:** [2.2.0, including WebGPU add-on](https://github.com/processing/p5.js/releases/tag/v2.2.0)
  and [2.4.0](https://github.com/processing/p5.js/releases/tag/v2.4.0).
  Local installed 2.4.0 includes p5.webgpu.js; local vendored header is 2.1.2.
- **p5 APIs:** [model / instancing](https://p5js.org/reference/p5/model/),
  [buildGeometry](https://p5js.org/reference/p5/buildGeometry/),
  [pixelDensity](https://p5js.org/reference/p5/pixelDensity/).
  The local vendored model implementation already forwards an instance count.
- **p5 WebGPU design:** [official contributor documentation](https://github.com/processing/p5.js/blob/dev-2.0/contributor_docs/webgpu.md)
  describes the experimental mode, async APIs, and explicitly says WebGPU mode
  is not aiming to be a more efficient renderer. This is branch documentation,
  not a guarantee about every 2.4.0 API; the backend measurements are local.
- **WebGPU specification:** [limits and requiredLimits](https://www.w3.org/TR/webgpu/#limits),
  [GPUDeviceDescriptor](https://www.w3.org/TR/webgpu/#dictdef-gpudevicedescriptor),
  [texel-copy layout](https://www.w3.org/TR/webgpu/#dictdef-gputexelcopybufferlayout).
  Portable defaults include 8192 texture side, 256 MiB max buffer,
  128 MiB max storage binding; request higher limits explicitly when supported.
  Resource-allocation success is not guaranteed by a limit alone.
- **WGSL specification:** [floating-point evaluation](https://www.w3.org/TR/WGSL/#floating-point-evaluation).
  Reassociation/fusion and accuracy allowances are reasons not to promise
  bit-identical PN trajectories across GPU implementations.
- **V8:** [pointer compression](https://v8.dev/blog/pointer-compression),
  [cage definitions](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/include/v8-internal.h),
  [heap allocation limits](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/heap/heap.h).
  Distinguish the pointer-compressed object heap from backing-store/GPU memory;
  virtual address-space size is not an available-RAM promise.
- **Node:** [old-space configuration](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib),
  [Buffer limits](https://nodejs.org/api/buffer.html#bufferconstantsmax_length).
  This task additionally checked the installed build and its configured limit.
- **Vite:** [official guide](https://vite.dev/guide/). Development/build tooling,
  not a replacement GPU API or browser memory allocator.
