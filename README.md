# cellular_automata

## Getting Started

Open `index.html` in your web browser and start editing `sketch.js`.

## Running Locally

For projects with media files, use a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx http-server

# Using VS Code Live Server extension
# Right-click index.html -> "Open with Live Server"
```

## Resources

- [p5.js 2.0](https://beta.p5js.org/)
- [p5.js Reference](https://p5js.org/reference/)

## My notes
### 3D Perlin Movement

`index.html` loads `sketch_1d_3d.js`, with multistate movement rules (version 4).
Set `n_states` to an integer from 2 through 9, including empty state 0.
The configured count includes empty plus `n_states - 1` randomly generated occupied colors.
State 0 never acts; each nonzero-state cell chooses one destination in the
next layer and retains its state/color when moving or staying. All occupied
states use the same movement probabilities.
Set `forward_probability` in the simulation parameters
to a finite number from 0 to 1. The examples below use `0.5`;
the script's configured value controls the actual probabilities.

| Destination | Probability |
| --- | --- |
| Continue the previous direction | `forward_probability` (50% when set to 0.5) |
| Each of the other eight directions | `(1 - forward_probability) / 8` (6.25% each when set to 0.5) |

There are nine directions: eight horizontal/vertical/diagonal displacements
in the x/y plane plus `[0, 0]`. The latter keeps the same x/y position while
advancing along z/time, forming a straight-up line in the 3D history.
Both lateral movement and staying update the stored direction to the actual
x/y displacement. A cell moving from
left to center therefore has a 50% chance of moving right when the parameter is 0.5.
If a cell occupies the same position in two consecutive layers, its stored
direction is `[0, 0]` and it has a 50% chance of continuing straight up at that setting.
For lateral directions, staying is one of the eight alternatives; for the
straight-up direction, all eight alternatives move to neighboring x/y cells.
Directions wrap across grid boundaries without reversing.

The local p5 Perlin field supplies initial directions (including straight up)
and movement samples.
`noise_space_scale` and `noise_time_scale` control its spatial and temporal
variation. One shared uniform random offset is added to the noise samples
each step, modulo 1. This gives the stated marginal probabilities over offsets
while keeping moves spatially correlated; cells do not make independent draws,
and finite runs need not realize the exact percentages.

Arrivals at the same destination merge into a single occupied cell with the
highest arriving state (for example, states 1 and 2 merge into state 2).
Direction vectors from all arrivals are summed equally, regardless of state,
then each component is reduced to its sign. If they
cancel completely, the resulting direction is `[0, 0]` (straight up).
A staying arrival contributes zero x/y displacement. Empty cells never
spawn occupied cells, so the occupied-cell count can only stay constant or decrease.

`pattern_size` controls the D4-symmetric seed blocks in the four corners;
the surrounding cells start empty. Directions and subsequent evolution
need not preserve the seed's symmetry.

### Legacy Majority Voting

The commented version-3 generator and count-based update path remain available.
To use them, comment out the version-4 `rule_map` declaration and `generateRules()`,
uncomment version 3, and set `n_states` as desired. Keep the movement helper
declarations in place; the update path is selected by the generated map's keys.
The voting neighborhood side length is
`2 * Math.floor(pattern_size / divisor) + 1`; for example,
`pattern_size = 48` and `divisor = 3` give a 33x33 neighborhood.
Its radius, vote count, and rule map are derived before initialization;
do not change the size inside `generateRules()`.

For seamless repetition across wrapped boundaries, choose a positive integer
pattern size that divides both `cols` and `rows` and enable the commented
full-plane tiling initializer instead of the corner blocks. Deterministic
voting preserves tile repetition, but can smooth away features or reduce
the smallest period.

## Testing

Run the movement regression tests without installing dependencies:

```bash
node --test tests/perlin-movement.test.cjs
```