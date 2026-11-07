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
### 3D Majority Voting

`index.html` currently loads `sketch_1d_3d.js`. Set `pattern_size` in its
simulation parameters to control the repeating D4-symmetric seed tile.
The voting neighborhood side length is `2 * Math.floor(pattern_size / 5) + 1`,
so a 16-cell tile uses a 7x7 neighborhood. Its radius, vote count, and rule map
are derived before initialization; do not change the size inside `generateRules()`.

For seamless repetition across wrapped boundaries, choose a positive integer
pattern size that divides both `cols` and `rows`. Deterministic voting preserves
the tile repetition, but can smooth away features or reduce the smallest period.