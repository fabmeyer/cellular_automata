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

`index.html` loads `sketch_1d_3d.js`, with binary movement rules (version 4).
State 0 is empty and never acts; each state-1 cell chooses one destination
in the next layer. Set `forward_probability` in the simulation parameters
to a finite number from 0 to 1 (default `0.5`).

| Destination | Probability |
| --- | --- |
| Continue the previous direction | `forward_probability` (default 50%) |
| Each of the other seven neighbors | `(1 - forward_probability) / 8` (default 6.25% each) |
| Stay in place | `(1 - forward_probability) / 8` (default 6.25%) |

Moving updates the stored direction; staying retains it. A cell moving from
left to center therefore has a 50% chance of moving right with the defaults.
Directions wrap across grid boundaries without reversing.

The local p5 Perlin field supplies initial directions and movement samples.
`noise_space_scale` and `noise_time_scale` control its spatial and temporal
variation. One shared uniform random offset is added to the noise samples
each step, modulo 1. This gives the stated marginal probabilities over offsets
while keeping moves spatially correlated; cells do not make independent draws,
and finite runs need not realize the exact percentages.

Arrivals at the same destination merge into a single 1. Incoming direction
vectors are summed, then each component is reduced to its sign. If they
cancel completely, the local Perlin field supplies a new direction.
A staying arrival contributes its retained direction. Empty cells never
spawn new 1s, so the occupied-cell count can only stay constant or decrease.

`pattern_size` controls the D4-symmetric seed blocks in the four corners;
the surrounding cells start empty. Directions and subsequent evolution
need not preserve the seed's symmetry.

### Legacy Majority Voting

The commented version-3 generator and count-based update path remain available.
To use them, comment out the version-4 `rule_map` declaration and `generateRules()`,
uncomment version 3, and set `n_states` as desired. Keep the movement helper
declarations in place; the update path is selected by the generated map's keys.
The voting neighborhood side length is
`2 * Math.floor(pattern_size / divisor) + 1`, so the current values
(`pattern_size = 16`, `divisor = 3`) give an 11x11 neighborhood.
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