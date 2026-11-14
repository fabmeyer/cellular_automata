# CHROMIUM_MEMORY — why the headless renderer JS heap tops out near 4 GB

Context: p5.js WebGL page, headless Chrome via Puppeteer 25.x (Chrome for Testing 157, macOS arm64, 24 GB RAM).
`performance.memory.jsHeapSizeLimit` ≈ 4192 MiB; `--js-flags=--max-old-space-size=8192` changes nothing.

Primary sources were read from `chromium.googlesource.com` `refs/heads/main` (V8 and Chromium) and the nodejs/node repo on `main`.
These are moving branches, not the exact Chrome 157 / V8 tags. Line numbers are approximate to the fetch date (2026-11-14).
Items I could not confirm are marked **unverified**.

## TL;DR

- The cap is structural, not a misconfiguration. On arm64/x64, V8 builds with pointer compression by default. Every on-heap object must sit inside a 4 GiB "cage".
- V8 clamps the old generation to the cage size, so `--max-old-space-size=8192` is accepted and then silently clamped. On a 24 GB machine the default is already 4 GiB, so the flag cannot raise anything.
- No runtime flag disables pointer compression. It is a build-time option (`v8_enable_pointer_compression`).
- `performance.memory.jsHeapSizeLimit` is V8's real `heap_size_limit`, but Blink quantizes it into coarse buckets topping out around 4e9. That explains the odd 3.76e9 reading.
- Memory outside the V8 heap is **not** capped by this limit. TypedArray/ArrayBuffer backing stores live in the V8 sandbox (about 1 TB of virtual address space), not in the 4 GiB cage. GPU buffers and textures live in the GPU process. Moving bulk data into TypedArrays or the GPU is the practical way past the cap.
- Escape hatches, cheapest first:
  1. Store data in TypedArrays or GPU textures.
  2. Use cross-origin or separate-process pages (**unverified** for this project).
  3. Run the simulation in Node, where `--max-old-space-size` can exceed 4 GB because official builds do not use pointer compression.

## Findings

### 1. Why the heap is capped near 4 GB (pointer compression)

- V8's pointer-compression design: 64-bit pointers are stored as 32-bit offsets from a base, and "all V8 objects are allocated within a 4-GB memory range".
  The blog says "Having such a hard limit is unfortunate, but V8 in Chrome already has a 2-GB or 4-GB limit on the size of the V8 heap".
  <https://v8.dev/blog/pointer-compression>
- The cage constant is `kPtrComprCageReservationSize = size_t{1} << 32`, with the same value for alignment.
  <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/include/v8-internal.h> (around lines 167–168)
- The old generation is hard-clamped to the cage:
  - Under `V8_COMPRESS_POINTERS`, `kAllocatorLimitOnMaxOldGenerationSize = kPtrComprCageReservationSize`.
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/heap/heap.h> (around lines 346–353)
  - In `Heap::ConfigureHeap`, `--max-old-space-size` is applied first and then `std::clamp(..., MinOldGenerationSize(), kAllocatorLimitOnMaxOldGenerationSize)`.
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/heap/heap.cc> (around lines 4924–4938)
  - So 8192 MiB is silently clamped to 4096 MiB. The clamp is not specific to Chrome: it applies wherever V8 is built with pointer compression.
- Default old-gen size: `physical_memory / 2` on 64-bit (non-Android), clamped to [256 MiB, `kDefaultMaxHeapSize` = 4 GB].
  A 24 GB Mac therefore gets exactly 4 GB by default.
  <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/heap/heap.cc> (`OldGenerationSizeFromPhysicalMemory`, around lines 359–372)
  <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/heap/heap.h> (around lines 339–344)
- Pointer compression is on by default for arm64 and x64: `v8_enable_pointer_compression = v8_current_cpu == "arm64" || "x64" || "loong64"`.
  <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/gni/v8.gni> (around lines 360–364)
  - Chromium consumes V8 through these gni defaults. Its gin code references sandbox/cage state (`V8.SandboxMode` UMA, ArrayBuffers allocated inside the sandbox).
    <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gin/v8_initializer.cc> (around lines 601–645)
  - I did **not** find an explicit Chromium `args.gn` line forcing it on for desktop. The conclusion that Chrome desktop ships with it rests on the V8 default plus the observed 4 GiB limit. Treat "Chrome desktop enables it" as strongly supported but not directly quoted (**unverified** as an explicit statement).
- Runtime disabling: I found no runtime flag.
  - `flag-definitions.h` has no pointer-compression flag, only sandbox testing/fuzzing flags.
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/flags/flag-definitions.h>
  - Pointer compression is controlled by GN args `v8_enable_pointer_compression`, `..._shared_cage` and `..._8gb`.
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/BUILD.gn> (around lines 475, 690–703)
  - There is a build option `v8_enable_pointer_compression_8gb` (default false). I could not confirm whether Chrome ships it, and the stock binary evidently does not (the cap is ~4 GiB). It would need a custom Chromium build anyway.

### 2. How Chromium sets the renderer heap limit

- `gin::IsolateHolder` builds `Isolate::CreateParams` and calls `constraints.ConfigureDefaults(AmountOfTotalPhysicalMemory, AmountOfVirtualMemory)`.
  This is the only sizing logic in gin; I saw no Chromium-side override of max-old-space-size.
  <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gin/isolate_holder.cc> (around lines 190–196)
- `ConfigureDefaults` sets max old and young generation from physical memory via `Heap::OldGenerationSizeFromPhysicalMemory` and `YoungGenerationSizeFromPhysicalMemory`.
  <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/api/api.cc> (around lines 595–611)
- `--js-flags` is honored: gin splits the string on commas and calls `v8::V8::SetFlagsFromString` for each flag (`SetFlags`).
  <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gin/v8_initializer.cc> (around lines 329–337)
  - The flag is parsed and applied. It simply gets clamped by the cage limit (finding 1).
  - `--max-old-space-size` is defined as a size_t in MB.
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/flags/flag-definitions.h> (around line 2538)
  - Lowering it works. Raising it past ~4096 does not.
- Whether the `--js-flags` string reaches the renderer in the Puppeteer/headless configuration was not re-verified at the process level, but a smaller value would be a quick empirical test (**unverified**).

### 3. Does `performance.memory.jsHeapSizeLimit` reflect the real limit?

- Blink's `MemoryInfo` reads `heap_statistics.heap_size_limit()` from V8.
  <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/timing/memory_info.cc> (around line 55)
- In the default bucketized mode it applies `QuantizeMemorySize` to used, total, and limit. Buckets are exponential, from ~10 MB to a largest bucket of "roughly 4GB".
  Values are also rate-limited to one refresh per twenty minutes (around lines 81–154).
  This explains the coarse 3,760,000,000 value you saw. A precise mode exists (50 ms rate limit) and is what you get with the `--enable-precise-memory-info` switch (I did not look up the switch definition).
- `heap_size_limit` is the V8 total heap limit, which includes young-generation space on top of the 4 GiB old generation. That plausibly explains 4192 MiB > 4096 MiB (my inference; **unverified**).
- So the number is real. It is not misreporting a higher limit.

### 4. Memory not counted in the JS heap

- **V8 sandbox:** with the sandbox enabled, ArrayBuffer backing stores are allocated inside the sandbox address space, not inside the 4 GiB compression cage.
  Chromium's gin code states "When the sandbox is enabled, ArrayBuffers must be allocated inside of it" and builds a PartitionAlloc pool inside it.
  <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gin/v8_initializer.cc> (around lines 618–645)
  - `kSandboxSizeLog2 = 40`, i.e. 1 TB, on most 64-bit targets (128 GB on Android and some architectures).
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/include/v8-internal.h> (around lines 223–251)
  - The sandbox is enabled whenever the shared-cage pointer compression is on, per `BUILD.gn` (around lines 798–803).
  - So large `Float32Array`/`Uint8Array`/`ArrayBuffer` allocations do not consume the 4 GiB JS heap. They are bounded instead by the sandbox size (1 TB virtual), physical RAM, and any per-ArrayBuffer length limit.
  - I did not find a primary source stating Chrome's per-ArrayBuffer maximum length (**unverified**).
- **GPU/WebGL buffers and textures:** these live in the GPU process, not in the renderer's V8 heap.
  This is well known Chromium architecture, but I did not pull a specific primary-source page for it (**unverified** here).
  `gl.bufferData` still needs the source data in the renderer transiently, so upload in chunks rather than holding everything in JS arrays.
- **Canvas backing:** the pixel store is also outside the V8 heap (**unverified** for the exact process/allocator).
- **Implication:** store big grids, state, or history in TypedArrays or GPU textures/framebuffers. Avoid large arrays of JS objects or nested JS arrays, and avoid JS strings and Maps for bulk data. That keeps the JS heap small while total process memory can grow well past 4 GiB.

### 5. Alternatives to raise memory

- **Node.js**
  - Node documents `--max-old-space-size` (and `--max-old-space-size-percentage`) as the way to set the V8 old-space limit.
    <https://github.com/nodejs/node/blob/main/doc/api/cli.md> (around lines 1978, 2269–2286)
  - Node's `configure.py` exposes pointer compression only as `--experimental-enable-pointer-compression`, described as "[Experimental] ... (limits max heap to 4GB and breaks ABI compatibility)". Official builds therefore do not use it.
    <https://github.com/nodejs/node/blob/main/configure.py> (around lines 872–876)
  - Without pointer compression the V8 clamp in `heap.h` is `numeric_limits<size_t>::max()`, so heaps well above 4 GB are possible, bounded by system memory.
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/heap/heap.h> (around lines 346–353)
  - I did not verify that the particular Node binary installed here is the official build; `node -p "process.config.variables.v8_enable_pointer_compression"` would confirm (**unverified** locally).
  - Node `Buffer` size is bounded by `buffer.constants.MAX_LENGTH`.
    <https://github.com/nodejs/node/blob/main/doc/api/buffer.md> (around lines 744–748)
  - `worker_threads` `resourceLimits.maxOldGenerationSizeMb` sets per-worker heap limits.
    <https://github.com/nodejs/node/blob/main/doc/api/worker_threads.md> (around lines 625–640)
  - p5 in Node would need headless-gl (or similar) for WebGL. I did not research its compatibility with this project's p5/WebGL usage (**unverified**).
- **Workers and the shared cage (Chrome)**
  - V8 documents two modes: per-isolate cage, and a process-wide shared cage in which "a single cage is shared across all isolates in a process".
    The shared cage is "required for the V8 Sandbox".
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/docs/heap/pointer-compression.md>
  - `v8_enable_pointer_compression_shared_cage` defaults to the value of `v8_enable_pointer_compression`, so it is on by default.
    <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/BUILD.gn> (around lines 699–701)
  - Consequently, workers in the same renderer process **share** that 4 GiB, which is the scenario the V8 blog warns about.
    <https://v8.dev/blog/pointer-compression> (section "Trivial heap layout")
    Web Workers will not multiply the budget; they split it. (Inference from the shared-cage definition; I did not confirm what Chrome's final build config is, so **unverified**.)
  - A separate renderer process (for example a cross-origin / separate-site page via site isolation) gets its own cage. Assigning data across processes means serializing through the browser (for example via `postMessage` in separate pages), which is awkward. (**Unverified**; the process-model claim is from general Chromium architecture, not read from source here.)
- **Firefox via Puppeteer:** SpiderMonkey does not use V8 pointer compression, and its heap is governed by `javascript.options.mem.max`.
  I did not fetch Mozilla or Puppeteer primary documentation to confirm the default or the pref, nor that WebGL works in headless Firefox (**unverified**).
- **Custom Chromium/V8 build** with `v8_enable_pointer_compression=false` (or the 8GB cage option). This is the only way to change the cage in Chromium, and it is high effort. Chrome for Testing binaries cannot be reconfigured.

### 6. Puppeteer launch options

- Puppeteer is a controller. It passes `args` through to Chrome and exposes `protocolTimeout` (CDP call timeout); it does not impose a memory cap. This is from my knowledge of the API (**unverified** here: I did not fetch the pages).
  <https://pptr.dev/api/puppeteer.launchoptions> — relevant options: `args`, `protocolTimeout`, `ignoreDefaultArgs`.
- Useful practical args:
  - `--enable-precise-memory-info` for exact `performance.memory` values (**unverified** against Chromium source here).
  - `--js-flags=--max-old-space-size=N` is only useful to lower the limit for testing.
  - `protocolTimeout` is unrelated to the heap cap. This project's runner avoids long-lived protocol calls by polling (see [HEADLESS.md](./HEADLESS.md)), so it does not need a larger timeout.

## Local measurements (this machine, 2026-11-14)

Puppeteer 25.17.0, Chrome for Testing 157 headless, macOS arm64 with 24 GB RAM, Node v26.12.1. The probe allocated JS objects (or 16 MiB `Float64Array`s) until the page crashed or hit a target.

| Setup | Reported `jsHeapSizeLimit` | Outcome |
|---|---|---|
| Chromium, no flag, JS objects | 4192 MiB | Page crashed at ~3818 MiB used |
| Chromium, `--js-flags=--max-old-space-size=16384`, JS objects | 4192 MiB | Page crashed at ~3818 MiB used (the flag cannot raise the cap) |
| Chromium, `--js-flags=--max-old-space-size=1024`, JS objects | 1120 MiB | Page crashed at ~957 MiB (the flag *is* honored when lowering, which resolves the finding-2 question) |
| Chromium, no flag, `Float64Array`s | 4192 MiB | Reached 12 GiB of ArrayBuffers with no crash (backing stores are outside the cage, confirming finding 4) |
| Node, `--max-old-space-size=12288`, JS objects | n/a | Exceeded 6.2 GiB `heapUsed` with no problem |

`node -p "process.config.variables.v8_enable_pointer_compression"` printed `0`, so the installed Node build does not use pointer compression (resolves the finding-5 local check).

## Practical options for this project (ranked by effort)

1. **Measure what is actually using the JS heap (low effort).** Take a heap snapshot or sample `performance.memory` with `--enable-precise-memory-info`.
   If usage is mostly JS arrays of numbers or objects, the 4 GiB cap is a data-layout problem, not a hard limit.
2. **Move bulk state to TypedArrays (low–medium).** Use `Uint8Array`/`Float32Array` for the grid and history, and keep large frames in ArrayBuffers.
   These live in the V8 sandbox (up to 1 TB virtual) and bypass the 4 GiB cage. Stream output out of the page incrementally (write frames to disk) instead of accumulating them.
3. **Keep state on the GPU (medium).** Hold the CA state in WebGL textures or framebuffers (ping-pong shaders) and read back only what is needed.
   This lives in the GPU process and also fits the p5 WebGL setup.
4. **Chunk and shard runs (medium).** Split a large run into batches, each in a fresh page or browser, and checkpoint state to disk between runs.
   Each page or process gets a fresh heap. Do not rely on Web Workers in the same process to add budget (they share the cage; finding 5).
5. **Run the simulation in Node (medium–high).** Official Node has no pointer compression, so `node --max-old-space-size=16384` works (up to physical RAM).
   Rendering would need a headless GL layer, which is the costly part; confirm the Node build first.
6. **Firefox via Puppeteer (medium, uncertain).** Unverified from primary sources for this project; WebGL support and heap limits need testing.
7. **Custom Chromium build without pointer compression (very high).** Not recommended.

## Sources

- V8 blog, Pointer Compression: <https://v8.dev/blog/pointer-compression>
- V8 docs, pointer compression and cages: <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/docs/heap/pointer-compression.md>
- V8 `src/heap/heap.h`: <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/heap/heap.h>
- V8 `src/heap/heap.cc`: <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/heap/heap.cc>
- V8 `src/api/api.cc` (`ConfigureDefaults`): <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/api/api.cc>
- V8 `src/flags/flag-definitions.h`: <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/flags/flag-definitions.h>
- V8 `include/v8-internal.h` (cage and sandbox sizes): <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/include/v8-internal.h>
- V8 `BUILD.gn`: <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/BUILD.gn>
- V8 `gni/v8.gni`: <https://chromium.googlesource.com/v8/v8/+/refs/heads/main/gni/v8.gni>
- Chromium `gin/isolate_holder.cc`: <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gin/isolate_holder.cc>
- Chromium `gin/v8_initializer.cc`: <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gin/v8_initializer.cc>
- Blink `memory_info.cc`: <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/timing/memory_info.cc>
- Node CLI docs: <https://github.com/nodejs/node/blob/main/doc/api/cli.md>
- Node `configure.py`: <https://github.com/nodejs/node/blob/main/configure.py>
- Node Buffer docs: <https://github.com/nodejs/node/blob/main/doc/api/buffer.md>
- Node worker_threads docs: <https://github.com/nodejs/node/blob/main/doc/api/worker_threads.md>
- Puppeteer launch options (not fetched): <https://pptr.dev/api/puppeteer.launchoptions>
