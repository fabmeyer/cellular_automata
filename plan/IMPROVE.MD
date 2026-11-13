# Performance findings and improvement ideas

## Goals and constraints

The performance audit covered the active application loaded by
[`index.html`](../index.html), its
[`simulation and renderer`](../sketch_1d_3d.js), the bundled p5 implementation,
styles, initialization, history tracking, scheduling, and regression tests.
No application code was changed during the audit.

The requested improvements should:

- Finish the complete image faster.
- Show smoother progressive generation.
- Support larger grids and greater depth.
- Reduce memory usage.
- Preserve the current translucency and empty-cell appearance.
- Keep all simulation layers available for rotation, replay, or export.

## Measurement context

Browser experiments were performed on November 12, 2026, using the bundled
p5.js 2.1.2 and an Apple M4 Pro GPU through ANGLE Metal.

The measured configuration used:

| Parameter | Value |
| --- | --- |
| Grid | 96 x 96 x 384 |
| States, including empty | 9 |
| Forward probability | 0.5 |
| Spatial and temporal noise scales | 0.1 |
| Pattern size | 48 |
| Initialization | Four D4-symmetric corner blocks |
| Logical canvas | 1536 x 3072 |
| Pixel density | 2 |
| Backing canvas | 3072 x 6144 |

Parameters and initialization were edited while the audit was underway.
Consequently, occupancy-dependent measurements below are not benchmarks of
the subsequently saved full-plane tiling configuration.

Timings measure JavaScript execution and drawing submission, not isolated
GPU execution or complete wall-clock generation time. The experiments
temporarily controlled scheduling and rendering in the browser. Results are
exploratory measurements, not statistically controlled speedup guarantees.

## Findings

### Rendering dominates simulation work

Every layer draws 9,216 individual cubes, including empty cells. A complete
384-layer run therefore submits 3,538,944 cube draws, representing approximately
42.5 million triangles.

Instrumentation confirmed 221,184 indexed draw calls across 24 layers, with
no instanced draw calls.

| Experiment | Observed time per layer | Qualification |
| --- | --- | --- |
| Original rendering, first 24 layers | 86-126 ms | Drawing submission |
| Simulation updates, same layers | 2-12 ms | Update computation only |
| Pixel density 1 | About 85 ms | Little drawing-submission improvement |
| Pixel density 1 with p5 development checks disabled | About 64 ms | Compared with about 85 ms at density 1 |
| Occupied cubes only, layer 24 | About 8-10 ms | Changes the image; not acceptable under current constraints |

The original density-2 canvas has approximately 18.9 million backing pixels.
Density 1 reduces this to approximately 4.7 million, but does not remove
per-cube JavaScript overhead.

### Occupancy falls, but drawing and allocation remain dense

In the sampled run, occupied cells fell from 8,176 initially to 958 at layer
24 and 61 at layer 383. Across the complete generated history, only 126,774
of 3,538,944 voxels were occupied, approximately 3.6%.

Despite this sparsity, the renderer draws every voxel and the simulation
creates an object for every position in each new layer.

These occupancy figures depend on the seed, movement parameters, and
initialization. They should not be assumed for other configurations.

### Empty cells are visually significant

Empty cells are rendered as translucent black cubes with alpha 0.05;
occupied colors use alpha 0.95. Empty cubes also participate in depth
occlusion. Skipping them is therefore a visual change, not a behavior-neutral
optimization.

### Cached meshes have an upfront cost

A browser experiment combining a complete layer with `buildGeometry()`
took approximately 492 ms to build and about 65 ms for its first draw.
Subsequent cached draws took about 0-0.2 ms of JavaScript submission time.

This may be useful for repeated rendering, but building such a mesh for
every new layer is not an obvious improvement over the current pipeline,
which draws each layer once. It also introduces substantial geometry storage.

## Recommended improvements

### 1. Prototype GPU-instanced cube rendering

**Priority: highest structural opportunity.**

Replace thousands of individual cube submissions with an instanced cube
draw per layer, supplying position and state/color as instance data. The
bundled p5 version supports instanced rendering.

This targets repeated drawing calls, matrix manipulation, style handling,
and uniform updates. It does not inherently reduce triangle count or
fragment-processing costs.

Requirements:

- Preserve cube order, alpha blending, depth writes, and empty-cell rendering.
- Avoid color sorting or other reordering without proving visual equivalence.
- Compare seeded reference images before accepting the new renderer.
- Measure complete generation and repeated-history rendering separately.
- Verify WebGL2 availability and decide explicitly how unsupported browsers
  should be handled.

Potential impact is substantial, but no instanced implementation was
benchmarked during this audit. Do not promise a specific multiplier.

References:
[p5 model and instancing](https://p5js.org/reference/p5/model/),
[WebGL optimization guide](https://p5js.org/tutorials/optimizing-webgl-sketches/).
The live reference may describe newer APIs; check details against bundled
p5.js 2.1.2.

### 2. Store complete history as typed state arrays

**Priority: high for memory, allocation pressure, and larger grids.**

Each voxel currently retains an object containing coordinates and state.
Coordinates can instead be derived from its array index.

A `Uint8Array` holding all 96 x 96 x 384 states requires **3.375 MiB** of
state storage. This preserves every layer rather than discarding history.
That figure excludes metadata, working buffers, direction data, and GPU
resources.

Use compact direction data and reusable collision buffers alongside the
state history. If resuming simulation from arbitrary past layers is required,
also retain or reconstruct the corresponding direction and random/noise
state; voxel colors alone are not sufficient.

Adapt directly dependent consumers and tests together, including row-history
extraction and rendering.

### 3. Disable p5 development checks in a performance mode

**Priority: quick win with measured benefit.**

With pixel density held at 1, disabling the Friendly Error System reduced
rendering submission from approximately 85 ms to 64 ms per layer: roughly
24% less CPU time in that experiment.

Keep checks enabled during development and disable them for validated
production/performance runs. This does not imply the complete application
will become 24% faster.

Reference:
[p5 Friendly Error System](https://p5js.org/reference/p5/disableFriendlyErrors/).

### 4. Make simulation updates sparse

**Priority: after the rendering bottleneck, or alongside storage changes.**

Iterate the already tracked occupied positions rather than scanning every
source position. Accumulate arrivals into reusable buffers and write the
resulting layer into compact history storage.

Preserve:

- One shared random phase per simulation step.
- Existing Perlin sampling and spatial correlations.
- Boundary wrapping and actual movement directions.
- Maximum arriving state on collision.
- Summation of all incoming vectors before reducing components to signs.
- Nonincreasing occupied-cell counts.

Sparse simulation does not require sparse rendering: empty cubes can remain
visible while simulation work visits only occupied sources.

### 5. Separate simulation throughput from presentation scheduling

**Priority: responsiveness and smooth progressive generation.**

The 1 ms timer does not produce one layer per millisecond; synchronous work
already exceeds that budget.

Use animation-frame scheduling with a bounded work budget and explicit
completion handling. Once rendering is faster, process multiple simulation
steps when the available budget permits.

Scheduling alone cannot make a 90 ms render smooth. Do not change random
sampling or simulation-step semantics to fit display timing.

### 6. Offer explicit preview-quality settings

**Priority: optional; not an appearance-preserving default.**

Pixel density 1 reduces backing-pixel count by 75%. It may reduce GPU and
framebuffer costs even though it barely improved JavaScript submission time
in the experiment.

Lower density or reduced antialiasing should be explicitly lower-quality
preview settings, with the original quality retained for final output.

Reference:
[p5 WebGL settings](https://p5js.org/reference/p5/setAttributes/).

### 7. Optimize secondary costs afterward

Lower-priority opportunities:

- Numeric direction IDs instead of string rule keys.
- Reusing temporary arrays and collision records.
- Gating repetitive diagnostic logging.
- Caching parsed colors; the exploratory test showed only a small benefit.
- Minifying and compressing the approximately 4.34 MB bundled p5 script for
  faster loading, rather than expecting faster simulation.

Do not prioritize Web Workers before addressing rendering. Workers can
improve responsiveness, but moving simulation work alone does not remove
the dominant drawing-submission cost.

## Changes to avoid without explicit approval

- Skipping empty cubes.
- Making translucent colors opaque.
- Removing internal faces without demonstrating equivalence for transparency.
- Sorting cubes by color or changing drawing order.
- Dropping historical layers.
- Disabling drawing-buffer preservation without replacing the current
  accumulated-image approach.
- Building a giant combined mesh for every layer without measuring its
  construction, upload, and memory costs.

## Dormant legacy majority-rule mode

The commented exhaustive majority-rule generator is not the active
performance bottleneck, but is infeasible at the originally audited settings.

With nine states and a 19 x 19 neighborhood, there are
`C(369, 8) = 7,897,874,979,241,962` count vectors. Including the current state
would produce **71,080,874,813,177,658 rule entries**.

Compute the majority rule directly rather than enumerating all possible
entries. If neighborhood counting becomes a bottleneck, consider sliding
histograms or per-state summed-area tables with correct wrapped boundaries.

These figures describe the original settings, not every possible legacy
configuration.

## Validation status

The initial baseline passed all 21 tests:

```bash
node --test tests/perlin-movement.test.cjs
```

After parameters and initialization were edited during the audit, the same
suite passed 15 of 21 tests. Several fixtures assume the previous corner
initialization and noise scales; the failures should be reconciled with the
intended configuration before using the suite as an optimization gate.
The audit did not modify those tests or application changes.

## Suggested execution order and acceptance checks

1. Establish a fixed-seed baseline and reconcile configuration-dependent tests.
2. Measure the development-check toggle as a small, isolated change.
3. Prototype appearance-preserving instancing.
4. Convert full history and working data to compact typed arrays.
5. Introduce sparse updates and presentation budgeting.
6. Reassess remaining hotspots before adding further complexity.

For each change, compare:

- Full generation wall-clock time, not just drawing submission.
- Median and high-percentile layer times and responsiveness.
- Peak JavaScript memory and GPU resource use where measurable.
- Draw calls and retained-history correctness.
- Every generated state and movement direction under identical seeded inputs.
- Reference images, including translucency, empty cells, and occlusion.
- Repeated rendering of retained history for rotation/replay.

Report measured improvements separately from theoretical or projected gains.
