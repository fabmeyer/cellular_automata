# PN smoothing: fixed 4/8-unit cubes moving one model unit

## Implementation status

The research below describes the pre-feature coordinate contract and alternatives.
An opt-in `pn.movementUnit` and shared `pn.slope` now implement sparse unit-lattice
movement with fixed cube size and z spacing. The selected behavior includes
footprint collision merging, contained wrapping, a coarse empty backdrop, and
position-sensitive stripe memory. See the current
[configuration reference](./CONFIG.md#one-unit-movement-with-unchanged-cube-size)
and [Perlin guide](./PERLIN_NOISE.MD#sub-cell-movement); older claims below about
the absence of this feature are historical research findings.

## Clarified conclusion

The user means **retain a cube side of 4 or 8 model units, but move/draw its position in one-unit increments**—not translate a four-logical-cell-wide strip by one index. This is feasible, but **not a configuration-only change** in the current representation. Cube size, cell-center spacing, layer spacing and scene sizing all share `grid.cellSize`. The earlier `[0,1,2,3] → [1,2,3,4]` logical-cell probe does not demonstrate this clarified requirement ([renderer.js:137–148](../sketch_3d/renderer.js#L137), [renderer.js:195–225](../sketch_3d/renderer.js#L195), [config.js:252–302](../sketch_3d/config.js#L252)).

Recommended direction: separate **footprint**, **position/movement units**, **initial spacing**, **layer spacing**, and **physical scene bounds**. Use unit-lattice anchors if movement must be integer model units; use floating positions if continuous curves are wanted. Preserve the original cube count and initial centers, not one enlarged cube for every newly subdivided cell. All approaches below are proposals, not implemented or benchmarked.

## Current coordinate contract

The active page loads `sketch_3d/perlin.js`; PN selects `PerlinMovement` ([index.html:12–19](../index.html#L12), [sketch_1d_3d.js:9–17](../sketch_3d/sketch_1d_3d.js#L9)). Write `c = cellSize`, `C = cols`, `R = rows`, and `D = settings.depth`:

| Quantity | Current mapping |
| --- | --- |
| Center at grid index `(x,y,z)` | `X = (x + 0.5 − C/2)c`, `Y = (y + 0.5 − R/2)c`, `Z = (z + 0.5 − D/2)c`. |
| Geometry | Cube side `c` in all three axes; neighboring centers and generations are also spaced by `c`. |
| Nominal scene / bitmap | Scene extent `Cc × Rc × Dc`; canvas `ceil(Cc·canvasScaleX) × ceil(Rc·canvasScaleY)`. |
| Projection | Rotated volume is fitted to an orthographic camera using aspect, padding and zoom. One model unit is **not necessarily one projected pixel**; direction also affects projected displacement. |

These are explicit in both rendering paths and camera/config setup ([renderer.js:18–37](../sketch_3d/renderer.js#L18), [renderer.js:77–78](../sketch_3d/renderer.js#L77), [renderer.js:137–148](../sketch_3d/renderer.js#L137), [renderer.js:152–169](../sketch_3d/renderer.js#L152), [renderer.js:195–225](../sketch_3d/renderer.js#L195), [config.js:252–302](../sketch_3d/config.js#L252)). Although config calls `cellSize` pixels, it is used as model-space geometry/spacing ([config.js:3–8](../sketch_3d/config.js#L3)). Antialiasing is a rendering attribute, not movement interpolation ([renderer.js:35–37](../sketch_3d/renderer.js#L35)). Headless output screenshots this canvas ([scripts/run-headless.cjs:190–215](../scripts/run-headless.cjs#L190)).

**Why quantized:** state layers contain one byte per integer cell, indexed `x*rows+y`. Legacy headings are nine integer directions; the preferred step is heading times the positive-integer movement limit, while alternatives remain adjacent integer steps. Thus limit `1` moves `c` model units per nonzero axis, and `1/c` is rejected. Trajectory offsets retain fractions, but movement is the difference of truncated offsets before the renderer sees it: slope `1/c` gives occasional whole-`c` jumps, not one-unit drawing each layer ([grid.js:3–10](../sketch_3d/grid.js#L3), [grid.js:20–39](../sketch_3d/grid.js#L20), [perlin.js:1–4](../sketch_3d/perlin.js#L1), [perlin.js:18–33](../sketch_3d/perlin.js#L18), [perlin.js:89–108](../sketch_3d/perlin.js#L89), [perlin.js:139–148](../sketch_3d/perlin.js#L139), [perlin.js:239–277](../sketch_3d/perlin.js#L239), [config.js:217–221](../sketch_3d/config.js#L217)).

## Initial conditions and dimensions must stay explicit

Initializers fill every cell of each coarse uniform block; seed mode samples states through `floor(index/resolutionFactor)`. PN subsequently tracks every occupied coordinate separately, not one particle per colored block ([initializers.js:10–42](../sketch_3d/initializers.js#L10), [perlin.js:68–83](../sketch_3d/perlin.js#L68)). `grid.factor` scales initial block sizes and selected noise/trajectory parameters; it does not create a separate model-unit movement setting ([config.js:118–168](../sketch_3d/config.js#L118), [tests/configuration.test.cjs:992–1007](../tests/configuration.test.cjs#L992)).

The untouched local config has factor `4`, `cellSize: 4`, initial resolution `2` (effective block side **8 logical cells**), legacy/wrap mode and movement limit `1`. Factor and seed are pre-existing edits, preserved here ([config.js:3–18](../sketch_3d/config.js#L3), [config.js:30–57](../sketch_3d/config.js#L30), [config.js:128–132](../sketch_3d/config.js#L128); inspected worktree diff).

To preserve the current initial image, each original occupied logical cell must still produce one `c`-sided cube centered at its original position; larger uniform seed blocks remain collections of these cubes. Retain coarse initialization/random draws, then map positions into the new representation. Merely re-running initialization on a denser grid changes the population and may change seeded patterns.

Changing `cellSize` to `1` alone shrinks geometry, spacing, scene and bitmap. Multiplying lateral counts by `c` compensates lateral extent, but enlarging every fine-cell cube to side `c` creates densely overlapping footprints and an extra extent of `c−1` at the edges if centers retain the fine-grid half-unit convention. Increasing `factor` while retaining `cellSize` enlarges the scene/bitmap. These follow from the mappings above—not equivalent solutions.

**Preservation contract proposed:** hold the old `Cc`, `Rc`, `Dc`, canvas dimensions, camera fit and initial centers fixed; only change lateral position increments. Keep layer pitch and cube depth `c` unless the user also wants finer z sampling. Retaining output dimensions does not guarantee all later `grow` geometry fits the unchanged camera.

## Actionable approaches

### A. Finer lateral lattice, fixed 4/8-unit footprints

Use unit-spaced **anchors**, one per original occupied cell, with side `c` geometry. Map initial centers to the old formula; centers for odd-indexed original cubes are offset by `c/2` from their original cell edges, not fine-grid `0.5`. Move anchors by ±1 model unit. Maintain physical bounds independently of anchor counts.

* **Sparse anchor map:** closest to current integer destination-merging rules; no need to allocate every unit site. PN iteration and renderer become anchor-based. Moderate structural work, but exact integer keys and deterministic merging remain straightforward.
* **Dense unit-site grid:** can retain array indexing, but initialization must mark only original centers; the renderer should draw anchors, not `c`-sided empty cubes at all fine sites. Otherwise translucent background and overdraw change substantially: current PN empty alpha defaults to `0.05` and both rendering paths draw all in-grid cells ([renderer.js:5–9](../sketch_3d/renderer.js#L5), [renderer.js:184–215](../sketch_3d/renderer.js#L184)).

Derived cost for unchanged lateral extent: `c²` sites—16× for `c=4`, 64× for `c=8`—per dense layer. Current PN scans all sites and rendering uploads/draws all sites, so those workloads scale too ([perlin.js:133–138](../sketch_3d/perlin.js#L133), [grid.js:9–10](../sketch_3d/grid.js#L9), [renderer.js:110–114](../sketch_3d/renderer.js#L110), [renderer.js:184–200](../sketch_3d/renderer.js#L184)). Refining z as well would give `c³` stored sites across a retained volume, but is unnecessary for one-unit lateral motion. Sparse anchors can retain the original particle count, subject to collision policy.

Do not treat a filled `c×c` patch of fine occupancy as an indivisible cube: per-site PN will independently move its pieces. A stamped footprint needs persistent object identity and one movement per object, not one movement per covered site.

### B. Floating positions / accumulated offsets

Keep one state-bearing particle per original occupied cell, initial spacing/footprint `c`, and an explicit model-space position. Add one model unit per chosen axis, or continuous trajectory increments. This avoids dense refinement and naturally supports future fractional movement, but replaces integer-key occupancy/history with particle identity and a defined collision lookup.

Existing trajectory fractions provide reusable curve calculations, not a complete particle system. Alternative moves can diverge from the planned trajectory, so actual position must accumulate **selected** movement; drawing only the planned curve would ignore deviations. To guarantee one-unit lateral increments, scale/define both preferred and alternative movements in model units, not just trajectory slope ([perlin.js:239–277](../sketch_3d/perlin.js#L239), [perlin.js:329–337](../sketch_3d/perlin.js#L329), [tests/perlin-movement.test.cjs:478–493](../tests/perlin-movement.test.cjs#L478)).

A sparse renderer needs instance positions/state attributes or textures, plus matching fallback/exterior handling; the current shader derives positions solely from instance ID and grid dimensions ([renderer.js:110–148](../sketch_3d/renderer.js#L110), [renderer.js:195–225](../sketch_3d/renderer.js#L195)). Position/history storage scales with particle count; floating footprint collisions require a spatial broad phase or potentially expensive all-pairs checks. No timing or memory estimate was measured.

### C. Render-only offsets: smaller change, different semantics

Keep the discrete simulation, but retain per-cell continuous visual offsets and apply them without scaling cube size or camera bounds. A **uniform shared** one-unit translation is especially simple, but only translates the layer as a whole; it does not smooth independent PN lines.

Per-particle interpolation/residual offsets require tracking correspondence through stays, wrapping and merges. They can make drawing smoother while simulation collisions and row-memory observations remain on the coarse lattice. Compressing each logical jump to one rendered unit changes visual motion scale rather than faithfully interpolating existing positions; final geometry may no longer match occupancy. Current layers are accumulated onto the canvas, and rolling simulation releases previous grids, so extra interpolation snapshots/offset history would have to be retained deliberately ([sketch_1d_3d.js:64–68](../sketch_3d/sketch_1d_3d.js#L64), [sketch_1d_3d.js:208–209](../sketch_3d/sketch_1d_3d.js#L208), [sketch_1d_3d.js:231–235](../sketch_3d/sketch_1d_3d.js#L231), [memory.js:17–19](../sketch_3d/memory.js#L17)).

## Visible behavior, collisions, boundaries and decisions

Fixed cubes shifted by one unit overlap adjacent-generation footprints by `c−1` along that axis (for axial movement); the nominal cube side is not inflated. Neighboring cubes moving differently can overlap **within** a layer. Transparent overlapping geometry may change apparent darkness/color because PN defaults to nonopaque states ([renderer.js:5–14](../sketch_3d/renderer.js#L5)). This is a consequence of retaining large footprints, not antialiasing.

Current collisions happen only at identical target coordinates: keep maximum state, sum/sign legacy directions, and merge/rebase trajectory progress. Footprint overlap and crossing paths are not collision detection ([perlin.js:149–162](../sketch_3d/perlin.js#L149), [perlin.js:280–306](../sketch_3d/perlin.js#L280), [perlin.js:332–346](../sketch_3d/perlin.js#L332), [tests/perlin-movement.test.cjs:762–787](../tests/perlin-movement.test.cjs#L762)). Unit anchors could preserve exact-center merging while permitting overlaps; footprint-based merging or exclusion would change density/color evolution. Floating equality alone is unsuitable for robust approximate collisions: specify tolerance, bins or footprint intersection and stable tie-breaking.

Current `wrap` is modulo cell indices; `grow` stores signed outside coordinates and checks safe integers. Exterior geometry is drawn with the original camera ([grid.js:63–64](../sketch_3d/grid.js#L63), [perlin.js:193–235](../sketch_3d/perlin.js#L193), [renderer.js:219–225](../sketch_3d/renderer.js#L219)). For new anchors/particles, wrap in **physical lengths** `Cc`/`Rc`, including overshoot; a footprint can straddle an edge before its center wraps. Choose whether to clip it, draw periodic copies, allow overhang, or wrap based on footprint edges. These choices cannot all preserve both the original image and strict containment.

Remaining decisions:

* “One unit” per axis per layer, or Euclidean length one? A `(1,1)` diagonal travels `√2`.
* Keep z pitch/depth `c` (recommended default), or also move/draw generations one unit apart?
* Preserve exact-center merging, adopt footprint collisions, or allow independent overlap? What happens to colors and direction at merges?
* Preserve empty-cell background as a separate coarse layer, or remove it? Wrap seam policy? Is fixed framing allowed to clip `grow` paths?
* Sample noise using physical positions converted to old grid coordinates (`X/c` with the matching origin), or retune it in model units? Current sampling uses grid coordinates and scaled drift/time parameters ([perlin.js:36–42](../sketch_3d/perlin.js#L36), [config.js:143–168](../sketch_3d/config.js#L143)).

Preserve seeded PRNG/noise, stable particle traversal and merge ordering for deterministic runs; do not promise unchanged geometry after changing movement/collision semantics. Browser setup seeds both sources and each PN layer consumes a shared random phase ([sketch_1d_3d.js:1–17](../sketch_3d/sketch_1d_3d.js#L1), [sketch_1d_3d.js:189–202](../sketch_3d/sketch_1d_3d.js#L189), [perlin.js:125–143](../sketch_3d/perlin.js#L125), [perlin.js:309–331](../sketch_3d/perlin.js#L309)).

## Evidence and future validation

This follow-up ran in-memory **fallback-renderer harness probes**, not WebGL/screenshots: at `cellSize=4/8`, cube side and adjacent-center spacing were 4/8; test-grid canvases were 96×96 / 192×192; fractional legacy limits were rejected. Earlier research ran four logical-width translation probes and five focused existing tests; those support the original grid interpretation only, not an implemented subcell feature. No new feature tests or benchmarks were run, and no simulation/config files were edited.

Future focused tests should assert initial center/count/footprint preservation, one-model-unit selected moves including alternatives, unchanged scene/canvas/camera/z contract, both shader and fallback mappings, selected collision policy, wrap overshoot/seam footprints, grow re-entry/clipping, trajectory reversal/deviation residuals, and seeded repeatability. Existing full-resolution, collision, boundary and camera fixtures are useful starting points ([tests/configuration.test.cjs:404–430](../tests/configuration.test.cjs#L404), [tests/configuration.test.cjs:1182–1204](../tests/configuration.test.cjs#L1182), [tests/perlin-movement.test.cjs:496–543](../tests/perlin-movement.test.cjs#L496), [tests/perlin-movement.test.cjs:838–880](../tests/perlin-movement.test.cjs#L838), [tests/perlin-movement.test.cjs:1112–1147](../tests/perlin-movement.test.cjs#L1112)). Tests must explicitly control steering/drift because the harness inherits those defaults ([tests/helpers.cjs:18–35](../tests/helpers.cjs#L18)).
