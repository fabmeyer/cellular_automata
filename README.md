# cellular_automata

A p5.js visualization of successive 2D generations stacked into a 3D volume.

## Getting started

Open [index.html](./index.html) in a browser. No installation, build step, or
server is required. A local server (such as VS Code Live Server) also works.

**Change settings only in [sketch_3d/config.js](./sketch_3d/config.js), then reload.**
There are no live controls. `setup()` validates active settings before allocating
the grid, creating the canvas, or starting the simulation. Invalid active values
throw descriptive errors in the browser console; they are not silently replaced.

## Central configuration

| Setting | Meaning / options | Default |
| --- | --- | --- |
| `grid.cols`, `grid.rows` | Positive integer plane dimensions | `96`, `96` |
| `grid.baseDepth` | Sideways generation count, including the initial plane | `192` |
| `grid.cellSize` | Positive cube size | `4` |
| `simulation.algorithm` | `"CA"` or `"PN"` | `"PN"` |
| `simulation.states` | Integer 2 through 9, including empty state **0** | `9` |
| `simulation.timeInterval` | Nonnegative delay between generations, in ms | `1` |
| `ca.rule` | `"counts"`, `"sum"`, `"majority"` | `"majority"` |
| `ca.neighborhoodSize` | Positive odd side length; independent of seed size | `9` |
| `ca.emptyStateProbability` | Probability in [0, 1], shared by the two random CA rules | `0.67` |
| `ca.cycleUniform` | Boolean enabling uniform-neighborhood cycling for all CA rules | `true` |
| `pn.mode` | `"legacy"` integer-direction movement or `"trajectory"` slopes/curves | `"legacy"` |
| `pn.boundary` | `"wrap"` across plane edges or `"grow"` beyond them | `"wrap"` |
| `pn.maxCellsPerAxisPerLayer` | Positive int32 limit in cells per axis per layer; legacy continuation speed, trajectory speed ceiling | `1` |
| `pn.forwardProbability` | Probability in [0, 1] of continuing the previous displacement (legacy) or following the planned movement (trajectory) | `0.1` |
| `pn.noiseSpaceScale`, `pn.noiseTimeScale` | Nonnegative Perlin spatial/time scales; zero fixes the corresponding sampling coordinates | `0.01`, `0.01` |
| `pn.trajectory.slope` | Nonnegative `[min, max]` slope, in cells per layer along the initial direction | `[0, 0.5]` |
| `pn.trajectory.bend` | Signed `[min, max]` change in slope per layer | `[0, 0]` |
| `pn.trajectory.amplitude` | Nonnegative `[min, max]` sine displacement, in cells | `[0, 0]` |
| `pn.trajectory.wavelength` | Positive `[min, max]` sine cycle length, in layers | `[32, 32]` |
| `pn.trajectory.phase` | `[min, max]` sine phase, in radians | `[0, 2 * Math.PI]` |
| `pn.trajectory.parameterNoise.spaceScale` | Nonnegative spatial scale for initial parameter fields; zero gives all cells identical parameters | `0.05` |
| `pn.trajectory.parameterNoise.channels` | `"separate"` parameter fields or one `"shared"` sample for all ranges | `"separate"` |
| `initial.mode` | `"random"` plane or reusable `"seed"` | `"seed"` |
| `initial.patternSize` | Positive integer seed side length, fitting both plane dimensions | `16` |
| `initial.symmetry` | `"plain"` or `"D4"` | `"plain"` |
| `initial.placement` | `"tiled"`, `"center"`, `"corners"` | `"tiled"` |
| `initial.loopPattern` | Corners only: repeat the seed across the surroundings instead of leaving them empty (state 0); center and tiled always loop | `true` |
| `memory.enabled` | Enable row-history tracking/reporting | `true` |
| `memory.capacityMultiplier` | Positive integer; state-based capacity = multiplier times states squared; history holds at least a quarter of the effective depth | `2` |
| `memory.matchRunFraction` | Fraction in (0, 1] determining the repeated-match threshold | `0.5` |
| `view.orientation` | `"sideways"` or `"vertical"` | `"vertical"` |
| `view.presets` | Depth multiplier, canvas scale, and rotation for each orientation | Sideways depth x1; vertical depth x2 |
| `view.cameraPadding` | Margin around the tightly fitted block, at least 1; larger zooms out | `1.05` |
| `view.zoom` | Positive zoom factor; above 1 zooms in, below 1 zooms out | `1` |
| `view.background` | Grayscale background, 0 through 255 | `10` |

Active integer settings and derived integer dimensions must fit signed 32-bit
range (`-2147483648` through `2147483647`). Active floating-point settings must
be finite and within the float32 magnitude limit (about `3.4e38`). These checks
do not round calculations; JavaScript continues to calculate using `Number`
precision. Existing per-setting limits still apply, such as states 2 through 9,
probabilities from 0 to 1, and background values from 0 to 255. Values within
these numeric ranges can still exceed available browser memory or rendering
capacity.

For example, select majority-voting CA by changing `simulation.algorithm` to
`"CA"` and `ca.rule` to `"majority"`. To place a symmetric seed in the center,
set `initial.mode = "seed"`, `initial.symmetry = "D4"`, and
`initial.placement = "center"`.

The default is the active sketch's PN/plain-tiled/vertical configuration, not
the corner placement described by older versions of this README.

### CA rules

All rules read the previous generation only. Neighborhoods include the center
and wrap in both plane dimensions. Large neighborhoods may wrap across a small
grid multiple times, counting each offset.

- **Counts:** one random output per neighborhood histogram (counts of every state).
- **Sum:** one random output per sum of all neighboring state values. Equal sums
  share the same rule, even when their histograms differ.
- **Majority:** the most frequent state wins. On a tie, keep the current state if
  it is tied for the lead; otherwise use state 0.

For counts and sum, a new rule outputs 0 with `ca.emptyStateProbability`;
otherwise it chooses uniformly among occupied states. Rules are generated on
first encounter and cached for the run, not redrawn on each lookup. This avoids
enumerating the enormous count-rule universe at 9 states and a 9x9 neighborhood.
There is no missing-rule fallback. Cache size and computation still grow with
the number of distinct neighborhoods actually encountered.

When `ca.cycleUniform` is true, an entirely state-s neighborhood produces
`(s + 1) % simulation.states`, overriding the selected rule. This applies to
all three rules. For sum rules the override checks the actual histogram, not
merely its sum.

### Perlin movement

See [the full Perlin noise guide](./docs/PERLIN_NOISE.MD) for parameter ranges,
units, visual effects, presets, and diagnostic findings.

PN does not turn noise directly into cell states. Empty cells never act. Every
occupied cell moves to one destination in the next generation and keeps its
state/color. The default `pn.mode: "legacy"` preserves the existing movement
algorithm described below.

There are nine heading directions: eight signed x/y directions plus `[0, 0]`
(a straight line through time). With `pn.forwardProbability`, continue the
retained heading multiplied by `pn.maxCellsPerAxisPerLayer`. A limit of 2 makes
heading `[1, 0]` move by `[2, 0]` per layer. Each of the other eight headings
remains an adjacent-cell alternative with probability
`(1 - pn.forwardProbability) / 8`, regardless of the limit. Subsequent continued
movement uses the alternative's heading at the configured speed. Staying becomes
the stored `[0, 0]` direction. With `pn.boundary: "wrap"`, movement wraps
without reversing.

Set `pn.boundary: "grow"` to let both PN modes continue beyond the original
x/y plane instead. Paths can collide outside or return inside; z still stops
at the configured depth. The camera remains fitted to the original block, so
outward cells may be clipped. Only occupied cells are stored and drawn outside
the original plane; row memory still observes the original x=0 stripe. Very
large exterior coordinates beyond JavaScript's safe integer range raise an error.

The local p5 Perlin field supplies initial directions and movement samples.
Each generation adds one shared uniform random offset to the samples, modulo
1. These give the stated marginal probabilities over offsets, not independent
draws per cell or exact percentages in a finite run.

Colliding arrivals merge into the **highest arriving state**. All incoming
displacement vectors are summed equally, then each component is reduced to its
sign. Complete cancellation produces `[0, 0]`. Occupied-cell counts can only
stay constant or decrease.

#### Zero scales and uniform motion

All three PN noise scales accept zero. They measure noise-coordinate increments
per grid cell (space) or per layer (time), not pixels or milliseconds. A scale of
0.5 advances one noise unit every two cells/layers; 1 advances one per cell/layer.
One noise unit is not an exact wavelength or correlation length.

- `noiseSpaceScale: 0` fixes movement noise x/y coordinates at zero, so all
  occupied cells start with the same direction.
- `noiseTimeScale: 0` fixes the movement noise time coordinate at zero.
- `trajectory.parameterNoise.spaceScale: 0` gives every starting cell the same
  sampled value for each parameter. Separate channels can still differ between
  parameters; shared channels use one sample for all ranges.

Zero freezes sampling coordinates; it does not force a zero noise value, a
vertical direction, or zero movement. Below `forwardProbability: 1`, the shared
random phase still allows movement alternatives.

With `forwardProbability: 1` and zero movement spatial scale, legacy mode
translates the whole layer in one fixed direction without collisions, even
across wrapped boundaries. Trajectory mode is also collision-free if the
parameter spatial scale is zero: all cells follow one common curved
displacement. Spatially varying trajectory parameters can still cause collisions
despite both movement scales being zero. Collision handling itself is unchanged.

#### Trajectory slopes and curves

Set `pn.mode = "trajectory"` to enable fractional slopes and curved paths.
All five trajectory parameters support `[min, max]` ranges. At initialization,
each occupied cell samples spatial Perlin noise and maps it into each range:
`min + noiseValue * (max - min)`. Equal endpoints give an exact parameter.

Nearby starting cells receive similar parameters. Smaller
`pn.trajectory.parameterNoise.spaceScale` makes larger regions of similar
paths; it is independent of the movement noise scales. Distant cells can differ,
but are not guaranteed to. Perlin values are not uniformly distributed across
the range and need not reach its endpoints.

With `channels: "separate"`, slope, bend, amplitude, wavelength, and phase use
fixed noise z offsets 1 through 5 respectively. Their fields can differ, but
are not statistically independent. With `"shared"`, all parameters use the same
sample (z offset 1), rising/falling together within their respective ranges.
Samples use initial x/y coordinates only, not color/state or position within a
seed tile. Parameters travel with the path and are not resampled in later
layers or after wrapping. Reload/reinitialization samples a fresh initial grid.
Only collision averaging subsequently changes a path's parameters.

The scalar displacement along the initial Perlin direction is:

```text
F(t) = slope*t + bend*t*t/2
       + amplitude*(sin(2*PI*t/wavelength + phase) - sin(phase))
```

`t` is the layer index and `F(0) = 0`. A negative bend slows and eventually
reverses movement; the sine term oscillates. The retained initial direction
includes `[0, 0]`, which remains stationary when following the exact trajectory.
These are parameterized curves, not arbitrary user-defined functions.

Continuous x/y displacement accumulates across layers, with integer positions
quantized toward zero relative to the path's starting point. Fractional progress
and orientation survive pauses. For an exact half-slope, set:

```js
// Within CONFIG.pn:
mode: "trajectory",
maxCellsPerAxisPerLayer: 1,
forwardProbability: 1,
trajectory: {
    slope: [0.5, 0.5],
    bend: [0, 0],
    amplitude: [0, 0],
    wavelength: [32, 32],
    phase: [0, 0],
    parameterNoise: { spaceScale: 0.05, channels: "separate" }
}
```

A positive x direction then has relative positions `0,0,1,1,2,2,...`;
negative directions mirror this. For an oscillating path, use `slope: [0, 0]`,
`amplitude: [2, 2]`, and `wavelength: [16, 16]`. To add gradual bending,
choose a small signed bend range appropriate for the simulation depth.

With `forwardProbability: 1`, paths follow the quantized trajectory exactly.
Lower values retain the same nine-outcome probability distribution, preferring
the trajectory's planned movement rather than the previous integer move.
An alternative replaces that layer's planned movement with one adjacent-cell
movement; it offsets the path locally without restarting its curve or phase.
Alternatives use the sign of the planned displacement as their heading: planned
`[2, 1]` uses the `[1, 1]` heading's eight alternatives. Only the preferred
movement may jump farther than one cell. Existing `forwardProbability` and
movement noise scales remain global.

`pn.maxCellsPerAxisPerLayer` is a global positive integer from 1 through
2147483647. In trajectory mode it raises the speed ceiling without multiplying
the slope or curve parameters. For example, limit 2 with slope `[2, 2]` permits
relative positions `0,2,4,...`, while slope `[0.5, 0.5]` still produces
`0,0,1,1,2,2,...`. The limit is per axis, not Euclidean distance; both x and y
can move by that many cells in a diagonal jump.

Configuration validation enforces the conservative continuous-speed bound:

```text
maxSlope + maxAbsBend*(effectiveDepth - 1)
         + 2*PI*maxAmplitude/minWavelength <= pn.maxCellsPerAxisPerLayer
```

Excessive settings throw an error before grid allocation; they are not clipped.
Trajectory validation logs the unrounded `speedBound`, `minimumIntegerLimit`,
`configuredLimit`, and effective `depth` to the browser console before checking
the limit, including when the configuration passes. The minimum integer limit
is at least 1. This is the conservative range-based bound, not the exact maximum
movement of the noise-sampled paths.
This bound can reject curves whose terms cancel enough to be safe. Vertical
view's greater effective depth can require a smaller bend. Ranges must be
ordered, finite float32 values; wavelength must also allow finite curve
evaluation. Invalid trajectory-mode noise samples fail explicitly.

With `"wrap"`, both modes wrap multi-cell jumps even across multiple grid widths.
With `"grow"`, they retain their actual destinations. Only
destinations are occupied and checked for collisions: crossing between layers
or jumping over a cell does not cause a collision unless destinations coincide.
Intermediate cells are not filled, so faster paths can leave visible gaps
between rendered cubes. The default limit 1 preserves adjacent-cell behavior.

Collisions retain the highest state/color, averaging incoming retained direction
vectors (without reducing them to signs), parameters, and fractional remainders
equally, regardless of color. Phase uses a circular mean; cancellation chooses
phase zero. Averaged phase is represented modulo a full turn, rather than
necessarily within the original phase range. The merged curve is rebased at the
collision cell with its fractional progress, continuing at the current layer
index without teleporting. Opposing directions can cancel into a stationary
path. This creates one new curve, not independently surviving incoming paths.

### Initial grids and compatibility

Every initializer works with every CA rule and PN. State values are selected
uniformly from all configured states, including 0; `ca.emptyStateProbability`
does not control initialization.

- `"random"` fills the entire plane with independently selected states.
- `"seed"` creates one random square. Optional D4 symmetry projects it onto its
  rotation/reflection orbits, then placement tiles it, centers it, or stamps
  identical copies into the four corners.
- Center placement always repeats the seed across the whole plane, aligned so
  the centered block is one exact tile; it never leaves empty surroundings.
- Corner placement does the same (aligned to the top-left block) when
  `loopPattern: true`. With `loopPattern: false`, the surroundings start empty
  (state 0). `loopPattern` is ignored for center and tiled placement.
  Corner blocks are stamped top-left, top-right, bottom-left, bottom-right;
  where they overlap, the last one wins.
- Tiling accepts nondivisible dimensions and clips partial edge tiles. For
  seamless repetition across wrapped boundaries, choose a seed size dividing
  both plane dimensions.

D4 describes the seed, not a guarantee of symmetric later evolution. PN
directions and movement can break symmetry. CA neighborhood size does not
change when seed size changes.

Inactive options are ignored: CA options under PN, PN options under CA, seed
options under random-plane initialization, memory tuning when disabled, and
empty-state probability under majority voting. Trajectory settings are ignored
in legacy PN mode. Switching algorithms never
depends on recognizing special keys in a rule map.

### Views and memory

By default, sideways generates `baseDepth` layers; vertical generates twice as
many. Rotation values are multiples of PI. Each preset defines canvas scales;
the orthographic camera fits the rotated block's on-screen outline tightly at
any rotation (the vertical default matches the original `ortho(-420, 420, 840, -840)` framing).
`view.zoom` scales this padded framing: 1 leaves it unchanged, and zooming in
can crop the block. The zoom and resulting projection must be usable as finite
float32 values; invalid settings raise an error during startup.
Changing view changes generation count and presentation, not shared-generation
evolution.

Colors are fixed by algorithm: CA draws state 0 as `rgba(0, 0, 0, 0.5)` and
other states as opaque random RGB colors. PN draws state 0 as
`rgba(0, 0, 0, 0.05)` and other states as random RGB colors with opacity `0.95`.

Memory stores the **x=0 row**, not the entire plane. It uses a bounded ring,
hashes followed by exact row comparisons, and looks for consecutive matches at
the same period. Its threshold is `max(1, floor(capacityMultiplier * states² *
matchRunFraction))`, capped at a quarter of the effective depth for periods up
to that length. History holds at least a quarter of the depth. A repeated row
is not proof of a repeated plane.

For CA `counts` and `sum` rules, each detected repetition changes one active
rule, preferring the repeated row and falling back to the rest of the layer.
Memory then starts measuring again from the current layer, so later repetitions
can trigger further changes. Uniform cycling is not changed. If no eligible
rule is available, memory reports this and retries on subsequent qualifying
layers. PN and CA `majority` only report repetitions; disabling memory skips
tracking and reporting.

Changing configuration requires reload. Each reload creates a fresh random
palette, seed, and random CA rules; runs are not reproducible by default.
Large grids/depths/neighborhoods still require sufficient browser resources.

## Code layout

The page uses ordered classic scripts so direct browser opening remains possible.

| File in [sketch_3d/](./sketch_3d/) | Responsibility |
| --- | --- |
| [config.js](./sketch_3d/config.js) | All settings, validation, derived dimensions |
| [grid.js](./sketch_3d/grid.js) | Cells, grid allocation, coordinates, wrapping |
| [initializers.js](./sketch_3d/initializers.js) | Random planes, seed symmetry and placement |
| [ca.js](./sketch_3d/ca.js) | CA neighborhoods and rule strategies |
| [perlin.js](./sketch_3d/perlin.js) | PN movement, probabilities, collision handling |
| [memory.js](./sketch_3d/memory.js) | Bounded repeated-row detection |
| [renderer.js](./sketch_3d/renderer.js) | Palette, canvas/camera, view rotations, cubes |
| [sketch_1d_3d.js](./sketch_3d/sketch_1d_3d.js) | Simulation lifecycle and p5 entry point |

## Testing

No dependencies need installing. With Node.js:

```bash
node --test tests/*.test.cjs
```

Tests load the same scripts in the same order as the page. They cover PN
probabilities, persistence, trajectory slopes/curves, spatial parameter fields,
wrapping, collisions, multistate colors, CA rules,
initializers, validation, camera fit, and memory rollover. A small-grid matrix
checks all 924 combinations of algorithms/rules/uniform-cycling, initializers,
orientations, memory switches, and representative state counts (2, 3, 9).
Additional comparisons verify that memory and view changes leave shared
generations unchanged.

## Resources

- [p5.js](https://p5js.org/)
- [p5.js Reference](https://p5js.org/reference/)
