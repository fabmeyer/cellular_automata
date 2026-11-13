# Perlin noise movement: ideas, parameters, and visual behavior

This guide describes the implemented `"PN"` algorithm, including `"legacy"`
and `"trajectory"` modes. It documents behavior rather than a snapshot of the
current editable settings.

Configure [config.js](../sketch_3d/config.js), select
`simulation.algorithm: "PN"`, and reload the page. There are no live controls.
The implementation is in [perlin.js](../sketch_3d/perlin.js); the
[README](../README.md) covers the rest of the application.

## 1. The idea

The visualization stacks successive 2D cell grids into a 3D volume. The x/y
coordinates describe a plane; z is the generation/layer index, not elapsed
wall-clock time.

PN uses noise to guide **movement**, not to turn noise directly into cell
states:

- State 0 is empty and never acts.
- Each occupied cell has one destination in the next layer.
- Movement preserves its state/color unless arrivals merge.
- Plane boundaries wrap rather than bounce.
- Collisions merge occupants, so occupied-cell counts can stay constant or
  decrease, but never increase through movement.

There are two modes:

| Mode | Idea | Typical appearance |
| --- | --- | --- |
| `"legacy"` | Continue a stored signed direction, with optional alternative movements. | Straight lines at probability 1; turning or irregular tracks below 1. |
| `"trajectory"` | Follow a parameterized continuous displacement, quantized onto cells, with optional deviations. | Fractional slopes, sweeping waves, bending and reversing paths. |

Trajectories are configurable curve families, not arbitrary user-provided
functions or sequences.

## 2. Parameters, allowed values, units, and visual effects

### Numeric rules

All numeric settings must be numbers, not strings. Floating-point settings must
be finite with magnitude no greater than `3.4028234663852886e38`. This is the
validator's float32 **magnitude** limit: calculations still use JavaScript
`Number` precision, not float32 rounding.

Each trajectory range is exactly `[min, max]`, with `min <= max`. Equal
endpoints select an exact value. Slope, bend, amplitude, and wavelength also
share the movement budget explained in section 7; their bounds are not
independent.

### Global PN settings

| Setting | Allowed values | Unit / meaning | Visual effect |
| --- | --- | --- | --- |
| `pn.mode` | `"legacy"` or `"trajectory"` | Algorithm variant. | Switches fixed-heading movement to parameterized curves. |
| `pn.maxCellsPerAxisPerLayer` | Integer 1 through 2147483647. | Maximum cells per x or y axis per layer. | Legacy continuation speed; trajectory speed ceiling. Larger jumps can leave gaps. |
| `pn.forwardProbability` | 0 through 1, inclusive. | Probability of selecting the preferred movement. | 1 follows a heading/trajectory exactly; smaller values allow more deviations. |
| `pn.noiseSpaceScale` | 0 through the finite magnitude limit. | Noise-coordinate units per grid cell in x and y. | Smaller generally creates broader patches of similar initial directions and movement samples. |
| `pn.noiseTimeScale` | 0 through the finite magnitude limit. | Noise-coordinate units per layer. | Smaller makes deviation noise evolve more gradually across layers. No path effect at probability 1. |

The movement limit is global, not a sampled per-cell range. It limits each axis
separately, not Euclidean distance: a diagonal move can travel the limit in both
x and y.

### Trajectory settings

All names below are under `pn.trajectory`.

| Setting | Allowed values | Unit / meaning | Visual effect |
| --- | --- | --- | --- |
| `slope` | Nonnegative `[min, max]`; maximum cannot exceed the global cap and must fit the shared budget. | Base scalar cells per layer along the retained direction. | Controls base tilt. With bend/amplitude zero, 0 is stationary and 0.5 gives a half-slope. |
| `bend` | Signed finite `[min, max]`, subject to the shared budget. | Change in scalar slope per layer: cells per layer squared. | Positive increases base tilt over time; negative slows it and can reverse it. |
| `amplitude` | Nonnegative finite `[min, max]`, subject to the shared budget. | Sine amplitude in scalar cells. | Larger produces wider waves; 0 disables oscillation. |
| `wavelength` | Strictly positive finite `[min, max]`, subject to the shared budget. | Layers per sine cycle. | Larger produces longer waves; smaller produces tighter waves and greater speed for the same amplitude. |
| `phase` | Any signed finite `[min, max]`; commonly `[0, 2 * Math.PI]`. | Radians; one full turn is `2 * Math.PI`. | Changes where each wave begins; differing phases stagger neighboring waves. |
| `parameterNoise.spaceScale` | 0 through the finite magnitude limit. | Noise-coordinate units per initial grid cell. | Controls sizes of regions with similar curve parameters, independently of movement noise. |
| `parameterNoise.channels` | `"separate"` or `"shared"`. | Relationship between parameter fields. | Separate fields vary differently; shared fields make all parameters rise/fall together within their ranges. |

Extremely small positive wavelengths are rejected if angular evaluation over
the effective depth would overflow.

Amplitude is the sine term's radius, with scalar peak-to-peak excursion `2*A`.
Because displacement is measured relative to the starting phase, departure
from the starting point can reach `2*A` from the sine term alone. Drift and
bending can add further displacement. In an initial diagonal direction the
scalar displacement applies to both axes; it is not a Euclidean-distance
amplitude.

### Related settings

| Setting | Meaning for PN |
| --- | --- |
| `grid.cols`, `grid.rows` | Positive int32 plane dimensions, in cells. |
| `grid.baseDepth` | Positive int32 base layer count, including layer 0. Effective depth also includes the selected view's depth multiplier. |
| `grid.factor` | In the supplied CONFIG getters, scales cols, rows, and baseDepth together. It is not a Perlin parameter; the derived dimensions are validated. |
| `grid.cellSize` | Positive finite cube size in pixels. It changes presentation, not cell-space motion or noise sampling. |
| `simulation.states` | Integer 2 through 9, including empty state 0. |
| `simulation.timeInterval` | Delay between rendered generations, 0 through 2147483647 milliseconds. It does not define `noiseTimeScale` or `wavelength`. |
| `memory.enabled` | PN repetition reporting only; it does not mutate PN movement rules or trajectories. |

Changing canvas size, rotation, or camera zoom does not change shared-generation
motion. Changing effective depth can change whether a bend range passes
validation.

## 3. What space and time scales actually mean

The movement field is sampled as:

```text
noise(x * noiseSpaceScale,
      y * noiseSpaceScale,
      (z - 1) * noiseTimeScale)
```

At initialization the time coordinate is 0.

These scales are **sampling increments**, not pixels, seconds, percentages,
or a guaranteed wavelength:

| Scale | Increment per cell/layer | Cells/layers needed to advance one noise unit |
| --- | --- | --- |
| 0 | No advance. | Coordinates remain fixed. |
| 0.001 | 0.001 noise units. | 1000 |
| 0.01 | 0.01 noise units. | 100 |
| 0.05 | 0.05 noise units. | 20 |
| 0.1 | 0.1 noise units. | 10 |
| 0.5 | Half a noise unit. | 2 |
| 1.0 | One noise unit. | 1 |

One noise unit is not an exact correlation length or one complete wave.
Smaller increments generally produce smoother variation between neighboring
samples. Larger increments sample farther apart, but do not guarantee
independence or a particular amount of variation.

For trajectory parameters, only initial spatial coordinates are sampled:

```text
noise(initialX * parameterNoise.spaceScale,
      initialY * parameterNoise.spaceScale,
      parameterChannel)
```

The channel coordinate is not elapsed simulation time.

## 4. Initial directions and spatial parameter fields

### Initial Perlin direction

Every occupied starting cell samples:

```text
u = noise(x * noiseSpaceScale, y * noiseSpaceScale, 0)
directionIndex = min(floor(u * 9), 8)
```

The ordered headings are:

```text
[-1,-1]  [ 0,-1]  [ 1,-1]
[-1, 0]  [ 0, 0]  [ 1, 0]
[-1, 1]  [ 0, 1]  [ 1, 1]
```

Nearby cells usually have similar noise values and often receive the same
direction. They can differ near a direction-bin boundary. Smaller spatial
scales create larger patches of common headings.

`noiseTimeScale` has no initialization effect because its coordinate is zero.

### Per-cell trajectory sampling

Each of the five parameters maps a Perlin value into its range:

```text
parameter = min + u * (max - min)
```

- Samples occur once per starting occupied cell.
- Coordinates are those of the full initial grid, not local seed-tile
  coordinates or the cell's color/state.
- Nearby starting cells receive similar underlying parameter values; distant
  cells can differ, but are not guaranteed to.
- Perlin values are not uniformly distributed across a range and need not
  reach the endpoints.
- Quantized paths can diverge at cell thresholds even when their parameters
  are close.
- Parameters travel with a path; they are not resampled at destination cells,
  wrapped seams, or later layers.
- Reinitialization samples the initial grid again. Collision averaging is the
  only subsequent parameter change.

`"separate"` uses fixed noise z offsets 1 through 5 for slope, bend, amplitude,
wavelength, and phase, respectively. `"shared"` uses offset 1 for all five.

Shared mode couples the **normalized position within each range**, not the
numerical values or units. For example, the same sample 0.5 selects the midpoint
of both a slope range and an amplitude range. Separate channels can have
different spatial patterns, but are not guaranteed statistically independent.

Initial direction uses the movement field at z=0, whereas parameters use their
own scale and channel slices. Sharing parameter channels does not force their
values to share the same sample as initial direction.

## 5. How trajectories become cell paths

For a sampled scalar slope `s`, bend `b`, amplitude `A`, wavelength `W`, and
phase `p`, displacement is:

```text
F(t) = s*t + b*t*t/2
       + A * (sin(2*PI*t/W + p) - sin(p))
```

`t` is the layer index. The phase subtraction ensures `F(0) = 0`.
Continuous x/y displacement is this scalar projected onto the retained
direction:

```text
x offset = direction.x * F(t)
y offset = direction.y * F(t)
```

The underlying scalar slope varies as:

```text
s + b*t + A*(2*PI/W)*cos(2*PI*t/W + p)
```

Consequently, positive base slope does not guarantee positive instantaneous
movement: a negative bend or the sine term can reverse it.

Before a collision, the retained direction is constant. The path bends through
the x/y/z stack, but its x/y displacement stays along that direction; this is
not an arbitrary independently steering curve in the x/y plane.

### Quantization and fractional slopes

Continuous positions are quantized toward zero relative to the retained
trajectory origin. Movement is the difference from the previous quantized
position, not a fresh rounding of each layer's velocity.

With positive x direction, bend/amplitude zero:

| Slope | Relative positions across layers |
| --- | --- |
| 0 | `0,0,0,0,0,0,...` |
| 0.5 | `0,0,1,1,2,2,...` |
| 1 | `0,1,2,3,4,5,...` |
| 2 | `0,2,4,6,8,10,...`, requiring a sufficient movement cap. |

Negative directions mirror positive motion. A pause does not erase trajectory
orientation or fractional progress. The implementation evaluates displacement
from a retained origin to avoid repeated decimal-addition drift, such as
delaying slope 0.1's first cell move beyond layer 10.

After collisions the origin is rebased at the collision layer and cell, with
the averaged fractional remainder. The new curve continues using the global
layer index; it does not jump back to an original seed location.

## 6. Preferred movement, alternatives, and randomness

Let `P = pn.forwardProbability`.

- The preferred movement has probability `P`.
- Each of eight alternative adjacent-cell movements has probability `(1-P)/8`.
- `P=1` always chooses the preferred movement.
- `P=0` never chooses the preferred movement.

The sample used for the choice is:

```text
sample = (localMovementNoise + oneSharedUniformRandomPhase) % 1
```

There is one random phase per layer, shared by all cells. These are marginal
probabilities over that phase, not independent draws per cell or guaranteed
percentages in a single generation.

### Legacy behavior

The preferred displacement is the retained signed heading multiplied by
`maxCellsPerAxisPerLayer`. If the cap is 2, heading `[1,0]` continues by `[2,0]`.
Alternative movements remain adjacent, regardless of the cap. Their resulting
heading is retained, and subsequent continuation uses the configured speed.
Staying stores `[0,0]`.

### Trajectory behavior

The preferred displacement is the actual quantized curve step. Raising the cap
does **not** multiply slope, amplitude, or any other curve parameter.

Alternative rules use the sign of the planned displacement. For example,
planned `[2,1]` uses heading `[1,1]` and the eight unit directions excluding
`[1,1]`. An alternative replaces that layer's planned movement with one adjacent
move; it shifts the path locally without restarting its phase, origin, or
fractional progress.

At `P=0`, parameters still influence the planned heading used to exclude an
alternative. They are not entirely disconnected from movement.

### Are the movement scales ignored in trajectory mode?

| Setting | At `P=1` | Below `P=1` |
| --- | --- | --- |
| `noiseSpaceScale` | Still chooses initial directions. | Also affects spatial variation of deviation samples. |
| `noiseTimeScale` | Has no effect on resulting paths. | Controls temporal variation of deviation noise. |
| `parameterNoise.spaceScale` | Determines initial curve parameter fields. | Still determines those fields independently of movement noise. |

The current implementation still samples movement noise and draws the shared
phase at `P=1`, even though they cannot change the selected movement. Active
settings and trajectory-mode noise samples are still validated.

Runs are not reproducible by default: initialization, the noise field, palette,
and random movement phases can differ between reloads.

## 7. The movement budget and console log

Set `pn.maxCellsPerAxisPerLayer` to a positive integer. It defaults to 1 in the
feature's baseline behavior, but the editable configuration may choose another
value.

For trajectory ranges, validation calculates:

```text
S = maximum slope
B = max(abs(minimum bend), abs(maximum bend))
A = maximum amplitude
W = minimum wavelength
D = effective depth

speedBound = S + B*(D-1) + 2*PI*A/W
```

It requires:

```text
speedBound <= pn.maxCellsPerAxisPerLayer
```

This is a conservative continuous-speed bound over all configured range
combinations and the effective simulation depth. It is **not the exact maximum
integer movement of the actual sampled paths**. It can reject curves whose
terms cancel enough to be safe, and shared parameter channels do not relax
the validation formula.

There is no silent clipping: excessive settings throw before grid allocation.
A runtime guard also rejects noninteger or over-cap trajectory steps.

### Choosing allowed ranges

For `D > 1`, after choosing slope, amplitude, and wavelength:

```text
maximum allowed bend magnitude
    = (cap - S - 2*PI*A/W) / (D-1)
```

The remaining budget must be nonnegative. Similarly, amplitude is limited by:

```text
maximum allowed amplitude
    = (cap - S - B*(D-1)) * W / (2*PI)
```

At cap 1 and depth 192:

- With slope/amplitude zero, bend magnitude can reach `1/191`, about 0.00524.
- With maximum slope 0.5 and amplitude zero, bend magnitude can reach
  `0.5/191`, about 0.00262.
- With maximum slope 1, bend and amplitude must both be zero.

Those bend examples apply to depth 192, not every grid size. Effective depth is
`grid.baseDepth * selectedView.depthMultiplier`. Increasing grid factor or
switching to a deeper view can require smaller bends or a larger cap.

### Startup logging

Trajectory configuration validation logs these fields before checking the cap,
even when it subsequently rejects the settings:

```json
{
  "speedBound": 20.08539816339745,
  "minimumIntegerLimit": 21,
  "configuredLimit": 1,
  "depth": 192
}
```

- `speedBound`: calculated bound without display rounding.
- `minimumIntegerLimit`: `max(1, ceil(speedBound))`.
- `configuredLimit`: the chosen global cap.
- `depth`: effective layer count.

The log prefix is `PN trajectory movement bound (cells per axis per layer):`.
Legacy and CA configurations do not produce this trajectory log.

The example above comes from slope maximum 0.2, bend magnitude 0.1, amplitude
8, wavelength minimum 64, and depth 192:

```text
0.2 + 0.1*191 + 2*PI*8/64 = 20.08539816339745
```

Cap 21 admits those ranges; cap 20 does not. Raising the cap permits the
trajectory's requested speed; it does not automatically increase that speed.
For smoother, slower paths, reduce bend or other speed contributions instead.

## 8. Why perfectly straight lines can remain

The initial direction can be `[0,0]`, selected when the initial noise value
is in `[4/9, 5/9)`. Every curve displacement is multiplied by that direction:

```text
[0,0] * anyCurveDisplacement = [0,0]
```

Therefore positive minimum slope and amplitude do not guarantee a curved path.
An isolated cell with slope 0.1, amplitude 7, and direction `[0,0]` stays at the
same x/y position for all layers at probability 1. Changing only its direction
to `[1,0]` makes it move.

Other reasons for straight-looking sections include:

- Opposing directions canceling at collisions.
- Fractional movement taking several layers to cross a cell boundary.
- A wavelength so long that only a nearly linear part of a wave is visible.
- Presentation/rotation hiding some lateral motion.

Nearby cells can share `[0,0]`, producing whole patches of straight lines.
Changing spatial scales may change these patches but does not guarantee their
removal. There is currently no setting excluding stationary initial directions
or forbidding stationary collision results.

## 9. Wrapping, collisions, and zero-noise configurations

### Destination-only movement

Both modes wrap targets in x and y, even when a jump crosses multiple grid
widths. Intermediate cells are not filled.

Only arrivals at the same destination in the same layer collide. Two paths can
cross between layers or jump over a cell without a collision. Faster movement
can leave gaps between rendered cubes and produce seam-to-seam visual jumps.

### Collision rules

All collisions retain the highest arriving state/color, not an average color.

- **Legacy:** sum actual incoming displacement vectors, then reduce each
  component to its sign. Longer preferred moves contribute their actual vector
  magnitude; color does not determine movement weighting.
- **Trajectory:** average incoming retained direction vectors, sampled scalar
  parameters, and fractional remainders equally across arrivals. Do not reduce
  the averaged direction to a sign. Phase uses a circular mean; cancellation
  chooses phase zero.

Averaged phase is represented modulo a full turn, not necessarily inside the
original phase range. Merging creates one new curve, not independently
surviving incoming paths or an exact average of their complete trajectories.
Opposing retained directions can cancel to `[0,0]`.

### What zero scales mean

| Zero setting | Result |
| --- | --- |
| `noiseSpaceScale: 0` | All initial movement noise x/y coordinates are zero; all starting cells get the same direction. |
| `noiseTimeScale: 0` | Movement noise's time coordinate stays zero. |
| `parameterNoise.spaceScale: 0` | Every starting cell receives identical parameter values for each parameter. Separate channels can still differ between parameters. |

Zero means uniform/frozen **coordinates**, not zero noise, no motion, or a
forced vertical direction. Below probability 1, the shared phase still permits
alternative movements.

Guaranteed uniform-motion cases at probability 1:

- Legacy with movement spatial scale zero: every cell translates by the same
  fixed displacement each layer, without collisions.
- Trajectory with movement spatial scale zero and parameter spatial scale zero:
  every cell follows the same time-varying displacement, without collisions.

These are uniform wrapped translations and preserve cell separations. They
remain collision-free even across seams.

Zero movement scales alone do not make trajectories collision-free if their
parameters still vary. A faster trailing path can catch a slower/stationary
path, even with identical initial headings and probability 1.

This is not a general collision-avoidance feature. There is no path repulsion,
swept collision detection, or multi-occupant grid storage.

## 10. Starting presets and visual tuning

The following snippets replace `CONFIG.pn` only. They do not change the grid,
initial occupancy, or palette. All other active settings must still be valid.

### Long, smooth waves

```js
CONFIG.pn = {
    mode: "trajectory",
    maxCellsPerAxisPerLayer: 1,
    forwardProbability: 1,
    noiseSpaceScale: 0.02,
    noiseTimeScale: 0.001,
    trajectory: {
        slope: [0, 0.05],
        bend: [0, 0],
        amplitude: [8, 16],
        wavelength: [128, 192],
        phase: [0, 2 * Math.PI],
        parameterNoise: {
            spaceScale: 0.02,
            channels: "separate"
        }
    }
};
```

Its speed bound is about 0.835398, below cap 1. Since bend is zero, that bound
does not grow with depth. On a 192-layer stack it shows about one to one-and-a-
half nominal wave cycles; a deeper stack shows more cycles.

- Probability 1 removes movement deviations that can obscure the curves.
- Amplitude 8-16 makes oscillation visible; amplitude 0.001 is usually sub-cell
  and visually negligible by itself.
- Long wavelengths produce broad sweeps.
- Small slope avoids excessive drift; bend zero avoids accumulating acceleration.
- Small parameter spatial scale makes neighboring paths form similar flowing
  groups. Shared channels can make the group variations more strongly coupled.

Perfectly straight `[0,0]` paths can still exist. Dense initial occupancy can
cause many merges and change the intended shapes.

### Exact half-slopes

```js
CONFIG.pn = {
    mode: "trajectory",
    maxCellsPerAxisPerLayer: 1,
    forwardProbability: 1,
    noiseSpaceScale: 0.02,
    noiseTimeScale: 0,
    trajectory: {
        slope: [0.5, 0.5],
        bend: [0, 0],
        amplitude: [0, 0],
        wavelength: [32, 32],
        phase: [0, 0],
        parameterNoise: {
            spaceScale: 0,
            channels: "shared"
        }
    }
};
```

Nonzero positive axis directions follow `0,0,1,1,2,2,...`. Initial headings
still vary with the movement spatial field; zero headings remain stationary.
Different headings can still collide.

### Faster fixed-heading legacy lines

```js
CONFIG.pn = {
    mode: "legacy",
    maxCellsPerAxisPerLayer: 2,
    forwardProbability: 1,
    noiseSpaceScale: 0,
    noiseTimeScale: 0
};
```

All cells share one fixed heading and move together. A positive x heading
gives `0,2,4,...`; `[0,0]` remains stationary. The result is collision-free,
but jumps can look disconnected. Trajectory settings are inactive in this mode.

### Practical tuning order

1. Start with probability 1 and bend zero.
2. Choose wavelength relative to the layer count.
3. Choose a visible amplitude, then check the logged speed bound.
4. Add a small slope if you want drift.
5. Add small signed bends only after considering the full effective depth.
6. Adjust the two spatial scales separately: one for initial headings, one for
   curve parameter grouping.
7. Lower probability only when irregularity is intentional.

For clearer individual tracks, consider fewer starting occupants. In this
project, corner placement with `loopPattern: false` leaves empty surroundings;
center placement always repeats the seed and is not a sparse-center option.

## 11. Diagnostics, compatibility, and limitations

### Configuration errors

A speed-bound error means the requested ranges exceed the chosen cap, not that
Perlin sampling failed. Reduce the speed contributions or raise the positive
integer cap; do not assume cap 1 is still sufficient after increasing depth.

Zero movement scales are valid. Wavelength zero is not valid, even when
amplitude is zero. Invalid trajectory-mode noise samples and missing movement
history fail explicitly rather than using a silent fallback.

PN options are ignored under CA. Trajectory options are ignored in legacy mode.
There is no automatic probability adjustment when setting scales to zero.

### Memory and presentation

The rendered grid retains generated layers up to the configured depth. PN
repetition memory stores only a bounded x=0 stripe history, not full planes,
and only reports repetition; it does not change PN rules.

PN renders empty state 0 with alpha 0.05 and occupied colors with alpha 0.95.
Colors come from a random palette, not directly from noise values.

Curves remain voxel-stepped. A larger cap does not add interpolation or smoother
rendering. Parameter ranges that pass numeric validation can still exceed
practical browser memory or rendering capacity with large grids/depths.

## 12. Implementation and verification references

- [config.js](../sketch_3d/config.js): settings, numeric validation, speed budget,
  and startup bound logging.
- [perlin.js](../sketch_3d/perlin.js): direction sampling, parameter fields,
  probability rules, quantization, wrapping, and collision merging.
- [sketch_1d_3d.js](../sketch_3d/sketch_1d_3d.js): simulation lifecycle and layers.
- [configuration tests](../tests/configuration.test.cjs): validation, allowed
  scales/limits, effective depth, and logging.
- [movement tests](../tests/perlin-movement.test.cjs): fractional/decimal slopes,
  curved paths, channels, probability boundaries, multi-cell movement, wrapping,
  collisions, and zero-scale behavior.

Run the existing tests without installing dependencies:

```bash
node --test tests/configuration.test.cjs tests/perlin-movement.test.cjs
```
