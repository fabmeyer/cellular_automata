# Configuration reference

Edit [`sketch_3d/config.js`](../sketch_3d/config.js) and reload the page.
The values below are examples from the editable configuration; consult the
file for current values. Computed values are shown separately where
`grid.factor` changes them.

The simulation builds a 2D grid at each generation and renders those layers as
a 3D volume. State `0` is empty; states `1` and above are occupied colors.

## Resolution and `grid.factor`

`grid.factor` is a positive integer resolution multiplier. The supplied
dimension and generation getters already use it. Initialization and PN
settings are written in **factor-1 units** and converted automatically when
the configuration is resolved:

| Editable setting | Effective value at factor `f` |
| --- | --- |
| `initial.patternSize`, `initial.resolutionFactor` | Value times `f` |
| `pn.noiseSpaceScale`, `pn.noiseTimeScale` | Value divided by `f` |
| `pn.noiseDrift` | Each component divided by `f` |
| `pn.trajectory.parameterNoise.spaceScale` | Value divided by `f` |
| `pn.trajectory.bend` | Each endpoint divided by `f` |
| `pn.trajectory.amplitude`, `pn.trajectory.wavelength` | Each endpoint times `f` |
| Memory's state-based history and match duration | Scaled by `f`; see [Memory](#memory) |
| `ca.neighborhoodSize` and CA update cadence | Unchanged |
| Slope, movement unit, phase, probabilities, movement limit, cell size, alpha, camera, and delay | Unchanged |

Do not manually multiply these settings when changing the factor. The
simulation still updates at every layer, so a factor-4 run is a finer,
approximately comparable composition, not an exact enlargement. Quantization,
collisions, CA evolution, stochastic deviations, and unchanged per-cell
transparency can produce different results.

For example, using the factor-1 values shown below and changing `factor`:

| Quantity | Factor 1 | Factor 4 |
| --- | ---: | ---: |
| Plane (`cols` x `rows`) | 96 x 96 | 384 x 384 |
| Base depth | 192 | 768 |
| Vertical view depth | 384 | 1536 |
| Generations, including initial layer | 672 | 2688 |
| Initial seed side / initial block side | 32 / 1 | 128 / 4 |
| Movement noise spatial / time scale | 0.01 / 0.5 | 0.0025 / 0.125 |
| Trajectory parameter-noise spatial scale | 0.01 | 0.0025 |
| Trajectory bend | `[-0.001, 0.001]` | `[-0.00025, 0.00025]` |
| Trajectory amplitude | `[16, 256]` | `[64, 1024]` |
| Trajectory wavelength | `[32, 1024]` | `[128, 4096]` |
| Vertical canvas, in pixels | 1536 x 3072 | 6144 x 12288 |

Increasing the factor increases the number of cells per plane approximately
quadratically and, with the default getter, the number of layers linearly.
Browser memory, GPU limits, and rendering time can become limiting.

## Grid

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `grid.factor` | See config | Positive integer resolution multiplier. |
| `grid.cols` | `96 * factor` | Positive integer number of cells along x. |
| `grid.rows` | `96 * factor` | Positive integer number of cells along y. |
| `grid.baseDepth` | `192 * factor` | Positive integer base depth in layers used for camera framing. The selected view multiplies it. |
| `grid.cellSize` | `4` | Positive cube side and generation spacing in model units. It affects scene/canvas dimensions and the physical PN movement cap; model units are not necessarily projected pixels. |

The dimension entries are JavaScript getters in the supplied config; replace
them with numeric values only if independent dimensions are desired. They are
not additionally scaled by the resolver.

## Simulation and randomness

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `simulation.algorithm` | `"PN"` | `"CA"` for cellular automata or `"PN"` for Perlin-guided movement. |
| `simulation.states` | `min(9, initial.patternSize)` | Integer from 2 to 9, including state `0`. The getter uses the editable, factor-1 pattern size. |
| `simulation.numGenerations` | `1.75 * baseDepth * selected depthMultiplier` | Positive integer number of layers, including the initial layer. Replace the getter with a number for an independent count. |
| `simulation.retainHistory` | `false` | If `true`, retain all CPU grid layers. If `false`, release consumed layers; the image already drawn on the canvas remains. Independent of row memory. |
| `simulation.seed` | See config | `null` generates a fresh seed, or set an integer from `0` through `4294967295` to replay a run. |
| `simulation.timeInterval` | `1` | Delay between rendered generations in milliseconds, from `0` through `2147483647`. It is not the PN time scale. |

The effective view depth controls camera framing, not the total number of
generations. With the default getter, changing orientation also changes the
generation count. If the count is overridden, shorter runs leave unused framed
space and longer runs can extend beyond the frame.

### What the seed controls

Set the same `simulation.seed` to compare runs. If it is `null`, startup
generates a fresh unsigned 32-bit seed. The console logs the effective seed
and whether it was generated or configured; copy the logged number into
`simulation.seed` to replay the run. The program:

1. Creates a seeded pseudorandom sequence for initial states, random CA rules,
   and PN's shared per-layer random phase.
2. Creates a separate sequence initialized with the **same seed number** for
   the color palette. Palette draws do not advance the simulation sequence.
3. Passes that **same seed number** to p5's `noiseSeed(seed)`, selecting the
   Perlin field.

The pseudorandom generator updates a 32-bit state using a linear congruential
formula and maps it to `[0, 1)`. It is deterministic, not cryptographic. With
the same settings and seed, a reload reproduces the run. With different
factors, the initial coarse pattern, palette, and noise field align, but the
subsequent discrete evolution can diverge.

`initial.mode: "seed"` means a reusable **initial pattern**; it is different
from the numeric `simulation.seed`. With `simulation.seed: null`, a newly
generated seed can change the pattern, palette, decisions, and Perlin field on
each reload.

### Startup settings log

After configuration validation, the browser logs a `Simulation settings:`
record containing JSON. It reports a UTC ISO 8601 timestamp, the effective seed and source, factor,
dimensions, active algorithm and initialization settings, memory thresholds,
actual alpha values, selected view, and canvas dimensions. Factor-scaled values
are the values used by the run, not the unscaled inputs. Inactive settings
and the palette are omitted. The headless runner forwards the same
record to its console; it does not save a separate metadata file.

## Coloring

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `coloring.state0Alpha` | `null` | Alpha for state 0: `null` uses the algorithm default; otherwise a number from 0 to 1. |
| `coloring.otherStatesAlpha` | `null` | Alpha for states 1 and above, with the same options. |

Alpha `0` is transparent and `1` is opaque. Defaults are `0.5` and `1` for CA,
and `0.05` and `0.95` for PN, respectively. Alpha is per cell and is not
adjusted for `grid.factor`; more overlapping transparent cells can look denser.

## Cellular automaton (`ca`)

These settings are active when `simulation.algorithm` is `"CA"`. The
neighborhood includes the center cell and wraps on both plane axes.

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `ca.rule` | `"sum"` | `"counts"`, `"sum"`, or `"majority"`. |
| `ca.neighborhoodSize` | `3` | Positive odd side length of the square neighborhood. It is not scaled by `grid.factor`. The maximum possible state sum must fit a signed 32-bit integer. |
| `ca.emptyStateProbability` | `0.5` | Probability from 0 to 1 that a newly generated counts/sum rule outputs state 0. Ignored for majority and for initial states. |
| `ca.cycleUniform` | `true` | If the entire neighborhood has the same state, output the next state cyclically, overriding the selected rule. |

- **Counts:** cache one random output per histogram of neighborhood states.
- **Sum:** cache one random output per sum of neighborhood state values.
- **Majority:** select the most common state; on a tie, keep the current state
  if it is tied for first, otherwise use state 0.

Counts and sum rules are generated on first encounter and reused. CA performs
one update per layer for every factor.

## Perlin movement (`pn`)

These settings are active when `simulation.algorithm` is `"PN"`. Occupied
cells move; state 0 does not. Colliding arrivals retain the highest arriving
state. With `"grow"`, cells may move outside the original plane, but the camera
does not expand to follow them.

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `pn.mode` | `"trajectory"` | `"legacy"` continues a retained heading; `"trajectory"` uses parameterized paths. |
| `pn.boundary` | `"grow"` | `"wrap"` wraps around plane edges; `"grow"` permits movement beyond them. |
| `pn.movementUnit` | `null` | Null/omitted keeps the original lattice. A positive value must divide `cellSize` into a safe integer number of ticks; e.g. `1` permits one-unit movement with 4/8-unit cubes. Enables sparse positions and footprint collisions/wrap. |
| `pn.slope` | `null` | Shared nonnegative ordered `[min, max]` movement units per layer in both modes. Null/omitted preserves legacy's preferred speed or the trajectory slope below. Explicit shared slope overrides `pn.trajectory.slope`. |
| `pn.maxCellsPerAxisPerLayer` | `100` | Positive integer cap per axis/layer in **cell-size units**, independent of movement resolution. Legacy also uses it as preferred speed in movement units when shared slope is null. |
| `pn.forwardProbability` | `1.0` | Probability from 0 to 1 of following the preferred movement. The remaining probability is split equally across eight alternative adjacent directions. |
| `pn.noiseSpaceScale` | `0.01` | Nonnegative factor-1 increment per cell in the movement noise's x/y inputs. Zero removes spatial dependence; drift can still change those inputs. |
| `pn.noiseTimeScale` | `0.5` | Nonnegative factor-1 increment per layer in the movement noise's z input. Zero fixes that input at zero. |
| `pn.noiseDrift` | `[0, 0]` | Two signed finite float32 values: x/y noise-coordinate translation per factor-1 layer. Equal positive components slide the field diagonally toward positive x/y. |
| `pn.noiseSteering` | `false` | Resample preferred headings each layer in both modes; trajectory also resamples its curve parameters. At probability 1, cells follow the field rather than retaining their initial headings. |

The movement limit applies separately to x and y, not to Euclidean distance.
Only destinations are occupied: larger jumps can leave gaps. Alternatives
move at most one movement unit per axis, regardless of preferred speed.

### One-unit movement with unchanged cube size

Keep `grid.cellSize: 4` or `8` and set:

```js
movementUnit: 1,
slope: [1, 1],
maxCellsPerAxisPerLayer: 1
```

With a lateral heading and probability 1, the preferred displacement is one
model unit per layer. The cube side, initial pattern/spacing, z pitch, camera,
and image dimensions stay unchanged. Slope `[4, 4]` with cell size 4 (or
`[8, 8]` with size 8) restores the previous base speed while still fitting a
one-cell cap. Fractional slopes retain progress: `[0.25, 0.25]` advances one
movement tick every four layers on a fixed straight path.

Both modes sample an explicit shared slope range. Legacy samples it using the
movement noise field at initialization and resamples it when steering is on;
trajectory retains its parameter-noise channel and steering behavior.
Trajectory bend and amplitude are also measured in movement units and consume
the same physical cap. Reducing movementUnit therefore changes their physical
scale unless their values are adjusted.

Supplying movementUnit enables sparse integer-tick anchors: initialization
still produces one cube per original occupied cell, not a denser field of
enlarged cubes. After initialization, PN layers are maps of `{x,y,state}`
anchors; x/y are ticks and StateGrid get/set use those tick coordinates.
Default PN and CA still use dense byte layers. History retention/release works
for both representations.

**Collision/wrap changes are opt-in:** intersecting same-layer footprints
merge, including transitive intersections; touching faces do not. The highest
state's destination center survives (ties use x then y coordinate order).
Headings/progress merge as before. Wrap brings crossing footprints to the
opposite boundary and clamps overhang so whole cubes fit inside the plane.
Grow permits exterior footprints and re-entry without expanding the camera.
These changes mean matching the old slope does not reproduce old geometry.

Empty cubes remain on the original coarse backdrop, with sites containing
occupied centers omitted. Occupied cubes are drawn at their actual positions;
the backdrop mask is not simulation occupancy. Sparse WebGL2 rendering remains
instanced, with a matching per-cube fallback.

### Inputs to Perlin noise

The **numeric seed selects the field**; it is not itself the x/y/z input to
each `noise()` call. Using the effective, factor-adjusted scales, the movement
sample for layer `z` is:

```text
t = z - 1
noise(x * noiseSpaceScale - t * noiseDrift[0],
      y * noiseSpaceScale - t * noiseDrift[1],
      t * noiseTimeScale)
```

At initialization, the third coordinate is `0`. The returned value selects
one of nine initial headings, including a stationary `[0, 0]` heading. During
movement, one shared pseudorandom phase is added to the sample modulo 1 to
select the preferred movement or an alternative. With `noiseSteering: false`,
at `forwardProbability: 1` the movement sample does not change the selected
path after initialization.

Drift translates the field; time scale evolves its shape. For pure diagonal
sliding, set `noiseTimeScale: 0`, `noiseDrift: [0.01, 0.01]`, and
`noiseSteering: true`. These settings work with either mode, including at
probability 1. This is a steering field, not rigid translation of the colored
initial pattern. Drift speed is in noise units, not grid cells; apparent speed
in cells depends on the spatial scale.

With steering enabled, trajectory parameters use the current cell coordinates
and `parameterNoise.spaceScale`, the same drift offsets, and z coordinate
`channel + t * noiseTimeScale`. Shared channels use 1; separate channels use
1 through 5. Each step differences a curve using that step's parameter set
and accumulates displacement, preserving fractional progress without jumping
to a newly sampled absolute position. The existing speed bound still applies.
With steering disabled, curve parameters remain sampled only at initialization.
Omitting both new settings is equivalent to zero drift and disabled steering.

These scales are noise-coordinate increments per cell or layer, not pixels,
seconds, or guaranteed wavelengths. Smaller spatial increments generally give
larger regions of similar samples; smaller time increments vary the samples
more gradually. Zero spatial scale removes position dependence; zero time scale
freezes the z coordinate. Drift can still change x/y coordinates over layers.

For factor 4 with the current settings, the effective movement scales are `0.0025` and
`0.125`. At cell `(100, 200)` for layer `41`, the sample inputs are
`noise(0.25, 0.5, 5)`.

### Trajectory parameters

`pn.trajectory` is active only in `"trajectory"` mode. Each range is an
ordered pair `[min, max]` of finite numbers. At initialization, a Perlin
sample `u` maps into each range as `min + u * (max - min)`. Equal endpoints
select one exact value. The samples need not be uniformly distributed across
the ranges or reach their endpoints.

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `pn.trajectory.slope` | `[0, 0]` | Compatibility fallback when `pn.slope` is null/omitted; otherwise shared slope is authoritative. Movement units per layer. |
| `pn.trajectory.bend` | `[-0.001, 0.001]` | Signed factor-1 change in slope per layer, in movement units. Negative values can slow and reverse a path. |
| `pn.trajectory.amplitude` | `[16, 256]` | Nonnegative factor-1 sine displacement amplitude in movement units. |
| `pn.trajectory.wavelength` | `[32, 1024]` | Strictly positive factor-1 sine cycle length in layers; must allow finite curve evaluation. |
| `pn.trajectory.phase` | `[0, 2 * Math.PI]` | Sine phase range in radians. |
| `pn.trajectory.parameterNoise.spaceScale` | `0.01` | Nonnegative factor-1 spatial increment for the initial trajectory parameter field. Zero gives every cell the same sample per channel. |
| `pn.trajectory.parameterNoise.channels` | `"shared"` | `"shared"` uses one Perlin sample for all five ranges; `"separate"` samples the five ranges at distinct noise z coordinates 1 through 5. |

Trajectory parameter noise is sampled at the **initial** cell position:

```text
noise(initialX * parameterNoise.spaceScale,
      initialY * parameterNoise.spaceScale,
      channel)
```

`channel` is `1` for shared sampling, or `1` through `5` in slope, bend,
amplitude, wavelength, phase order for separate sampling. This third input is
a field slice, not elapsed time. Parameters travel with a path and are not
resampled at every layer; collisions can average them.

Before collisions, the scalar displacement along the initial direction is:

```text
F(t) = slope*t + bend*t*t/2
     + amplitude * (sin(2*PI*t/wavelength + phase) - sin(phase))
```

Here `t` is the layer index and `F(0) = 0`. Displacement is quantized to movement
ticks; the initial direction can be stationary. Alternatives can locally
deviate from the planned trajectory.

The resolver checks a conservative speed bound using **effective** trajectory
values and the total generation count:

```text
maxSlope + maxAbsBend * (numGenerations - 1)
         + 2 * PI * maxAmplitude / minWavelength
    <= pn.maxCellsPerAxisPerLayer * (cellSize / effectiveMovementUnit)
```

The startup console reports this bound and the configured limit. Invalid
settings fail explicitly; the bound can reject some paths whose terms would
cancel. See the [Perlin guide](./PERLIN_NOISE.MD) for movement,
collision, and sampling details.

## Initial pattern

All initial state draws are uniform across the configured states, including 0.
`ca.emptyStateProbability` does not affect initialization.

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `initial.mode` | `"seed"` | `"random"` fills the plane with random blocks; `"seed"` creates a reusable square pattern. |
| `initial.patternSize` | `32` | Positive factor-1 side length of the seed square. Its effective size must fit both plane dimensions. Ignored in random mode, except that the default `simulation.states` getter reads it. |
| `initial.resolutionFactor` | `1` | Factor-1 side length of same-state blocks. It may be fractional, but after multiplication by `grid.factor` it must be a positive integer; in seed mode it must divide the effective `patternSize` exactly. |
| `initial.symmetry` | `"D4"` | `"plain"` or `"D4"` rotation/reflection symmetry, applied to the coarse seed. Seed mode only. |
| `initial.placement` | `"tiled"` | `"tiled"`, `"center"`, or `"corners"`; seed mode only. |
| `initial.loopPattern` | `true` | In corner placement, `true` repeats the pattern across the plane; `false` leaves the surroundings at state 0. Ignored for other placements. |

Tiled and centered seeds always repeat across the plane; centered placement
aligns the repetition around the centered block. Corner placement stamps the
same seed into all four corners, with the last stamp winning if they overlap.
Random mode clips partial blocks at plane edges. Only the initial layer is
block-expanded; later generations evolve at cell resolution.
For example, `resolutionFactor: 0.5` with `grid.factor: 4` produces 2x2
blocks. The product is checked using JavaScript `Number` precision without
rounding.

## Memory

Memory watches the `x = 0` stripe of each layer, not the entire plane. A
matching stripe does not prove that the entire plane repeats.

In position mode this is the original first-column-width physical stripe.
Snapshots include exact tick positions and states of centers inside that
stripe and the plane's y extent, so sub-cell movement is not mistaken for
repetition. The coarse backdrop is never used for memory comparisons.

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `memory.enabled` | `true` | Enables repetition tracking and reporting. |
| `memory.capacityMultiplier` | `1` | Positive integer multiplier for state-based history. Ignored when memory is disabled. |
| `memory.matchRunFraction` | `1` | Fraction in `(0, 1]` of the state-based history used to determine the consecutive-match threshold. Ignored when memory is disabled. |

With `f = grid.factor`, `s = simulation.states`, `m = capacityMultiplier`,
`r = matchRunFraction`, and `depth = baseDepth * selected depthMultiplier`:

```text
history capacity = max(m * s^2 * f, floor(depth / 4))
match threshold  = f * max(1, floor(m * s^2 * r))
```

For periods up to `floor(depth / 4)`, the required consecutive match count is
capped at that quarter depth. With default settings at factor 4, history
capacity is `384` and the match threshold is `324` layers.

For CA counts/sum, a detected repetition can mutate one active rule and reset
the memory tracking. PN and CA majority only report repetitions; disabling
memory prevents both tracking and CA rule mutation.

## View

| Parameter | Default | Meaning and constraints |
| --- | --- | --- |
| `view.orientation` | `"vertical"` | Selects `"sideways"` or `"vertical"` preset. |
| `view.presets.sideways.depthMultiplier` | `1` | Positive integer multiplier applied to base depth. |
| `view.presets.sideways.canvasScale` | `[3, 3]` | Positive x/y canvas multipliers. |
| `view.presets.sideways.rotation` | `[-1/6, 1/3, 0]` | x/y/z rotations as multiples of PI. |
| `view.presets.vertical.depthMultiplier` | `2` | Positive integer multiplier applied to base depth. |
| `view.presets.vertical.canvasScale` | `[4, 8]` | Positive x/y canvas multipliers. |
| `view.presets.vertical.rotation` | `[2/3, 1, -1/3]` | x/y/z rotations as multiples of PI. |
| `view.cameraPadding` | `1.05` | Camera margin around the fitted block, at least 1. Larger values zoom out. |
| `view.zoom` | `1.0` | Positive zoom: above 1 zooms in, below 1 zooms out. Zooming in can crop the block. |
| `view.antialias` | `true` | Enable WebGL antialiasing; can increase GPU memory usage. |
| `view.background` | `10` | Grayscale background from 0 to 255. |

Canvas dimensions are `ceil(cols * cellSize * canvasScale[0])` by
`ceil(rows * cellSize * canvasScale[1])`, at pixel density 1. The orthographic
camera fits the rotated original block, adjusted by padding and zoom; grown
cells outside the block can be clipped.

## Validation and resource limits

Active integer values and derived dimensions must fit signed 32-bit range
unless otherwise specified for the unsigned seed. Active floating-point values
must be finite and have magnitude no greater than approximately `3.4e38`.
JavaScript calculations still use `Number` precision; the float32 rule is a
magnitude check, not rounding. Individual probabilities, ranges, and other
constraints above also apply. Inactive CA, PN, trajectory, seed-placement, and
disabled-memory settings are not generally validated.

The renderer checks WebGL texture, renderbuffer, and viewport limits, but
passing those checks does not guarantee sufficient GPU memory. Allocation
errors and context loss stop the run explicitly. Reduce canvas scale, factor,
or disable antialiasing if the output exceeds available resources. See the
[headless guide](./HEADLESS.md) for running and observing exports.
