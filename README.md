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
| `ca.cycleUniform` | Separate boolean for each CA rule | Counts/sum off; majority on |
| `pn.forwardProbability` | Probability in [0, 1] of continuing the previous displacement | `0.25` |
| `pn.noiseSpaceScale`, `pn.noiseTimeScale` | Positive Perlin spatial/time scales | `0.05`, `0.05` |
| `initial.mode` | `"random"` plane or reusable `"seed"` | `"seed"` |
| `initial.patternSize` | Positive integer seed side length, fitting both plane dimensions | `16` |
| `initial.symmetry` | `"plain"` or `"D4"` | `"plain"` |
| `initial.placement` | `"tiled"`, `"center"`, `"corners"` | `"tiled"` |
| `initial.loopPattern` | Corners only: repeat the seed across the surroundings instead of leaving them empty (state 0); center and tiled always loop | `true` |
| `memory.enabled` | Enable row-history tracking/reporting | `true` |
| `memory.capacityMultiplier` | Positive integer; capacity = multiplier times states squared | `2` |
| `memory.matchRunFraction` | Fraction in (0, 1] determining the repeated-match threshold | `0.5` |
| `view.orientation` | `"sideways"` or `"vertical"` | `"vertical"` |
| `view.presets` | Depth multiplier, canvas scale, and rotation for each orientation | Sideways depth x1; vertical depth x2 |
| `view.cameraPadding` | Margin around the tightly fitted block, at least 1; larger zooms out | `1.05` |
| `view.background` | Grayscale background, 0 through 255 | `10` |
| `view.emptyColor` | p5 color string for state 0 | `"rgba(0, 0, 0, 0.05)"` |
| `view.occupiedAlpha` | Opacity in [0, 1] for random occupied-state colors | `0.95` |

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

When `ca.cycleUniform[ca.rule]` is true, an entirely state-s neighborhood
produces `(s + 1) % simulation.states`, overriding the selected rule. This is
available for all three rules; only majority enables it by default. For sum
rules the override checks the actual histogram, not merely its sum.

### Perlin movement

PN preserves the existing movement algorithm; it does not turn noise directly
into cell states. Empty cells never act. Every occupied cell moves to one
destination in the next generation and keeps its state/color.

There are nine displacements: eight adjacent x/y directions plus `[0, 0]`
(a straight line through time). Continue the previous displacement with
`pn.forwardProbability`; each of the other eight has probability
`(1 - pn.forwardProbability) / 8`. Staying becomes the stored `[0, 0]` direction.
Movement wraps at plane boundaries without reversing.

The local p5 Perlin field supplies initial directions and movement samples.
Each generation adds one shared uniform random offset to the samples, modulo
1. These give the stated marginal probabilities over offsets, not independent
draws per cell or exact percentages in a finite run.

Colliding arrivals merge into the **highest arriving state**. All incoming
displacement vectors are summed equally, then each component is reduced to its
sign. Complete cancellation produces `[0, 0]`. Occupied-cell counts can only
stay constant or decrease.

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
empty-state probability under majority voting. Switching algorithms never
depends on recognizing special keys in a rule map.

### Views and memory

By default, sideways generates `baseDepth` layers; vertical generates twice as
many. Rotation values are multiples of PI. Each preset defines canvas scales;
the orthographic camera fits the rotated block's on-screen outline tightly at
any rotation (the vertical default matches the original `ortho(-420, 420, 840, -840)` framing).
Changing view changes generation count and presentation, not shared-generation
evolution.

Memory stores the **x=0 row**, not the entire plane. It uses a bounded ring,
hashes followed by exact row comparisons, and reports matching past rows plus
consecutive generations with matches. The reporting threshold is
`max(1, floor(capacity * matchRunFraction))`. A repeated row is not proof of
a repeated plane. Memory never changes rules, stops the simulation, or consumes
random numbers; disabling it skips all tracking and reporting.

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
probabilities, persistence, wrapping, collisions, multistate colors, CA rules,
initializers, validation, camera fit, and memory rollover. A small-grid matrix
checks all 924 combinations of algorithms/rules/uniform-cycling, initializers,
orientations, memory switches, and representative state counts (2, 3, 9).
Additional comparisons verify that memory and view changes leave shared
generations unchanged.

## Resources

- [p5.js](https://p5js.org/)
- [p5.js Reference](https://p5js.org/reference/)
