class Cell {
    constructor(x, y, z, state) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.state = state;
    }
}

// grid parameters
const cols = 96;
const rows = 96;
const depth = 192;
const cell_size = 4;

// create a 3D array with given number of columns, rows, and depth
let grid = new Array(cols).fill().map(() => new Array(rows).fill().map(() => new Array(depth).fill(null)));

// simulation parameters
const time_interval = 5;
const n_states = 3; // number of different states
// assert n_states is less than 10, otherwise the rule map will be too large to handle
if (n_states >= 10) {
    throw new Error("n_states should be less than 10");
}
const neighborhood_width = 1; // 3d neighborhood width, should be an odd number
// 3d neighborhood with 1 means the cell itself and its 26 neighbors, so 27 states in total (3x3x3)
const neighbor_count = 9; // 2D 3x3 neighborhood from previous layer
let time_step = 0;

// create n different colors for different states
// if n_states is 2, we can use black and white
var colors = getRandomColor();
function getRandomColor() {
    let colors = [];
    colors.push('rgba(0, 0, 0, 0.5)'); // transparent for state 0
    for (let i = 1; i < n_states; i++) {
    // for (let i = 0; i < n_states; i++) {
        const r = Math.floor(Math.random() * 255);
        const g = Math.floor(Math.random() * 255);
        const b = Math.floor(Math.random() * 255);
        colors.push(`rgb(${r}, ${g}, ${b})`);
    }
    // console.log(colors);
    return colors;
}

// version 1
let rule_map = generateRules();
function generateRules() {
    // Count-based rule classes (multiset): order does not matter.
    // Number of classes is C(neighbor_count + n_states - 1, n_states - 1).
    p_c_0 = 0.85 // probability of a class mapping to state 0 (empty)
    let rule_map = new Map();
    function buildCountVectors(remaining, stateIndex, counts) {
        if (stateIndex === n_states - 1) {
            counts[stateIndex] = remaining;
            let key = counts.join(',');
            let value = Math.random() < p_c_0 ? 0 : 1 + Math.floor(Math.random() * (n_states - 1));
            rule_map.set(key, value);
            return;
        }
        for (let count = 0; count <= remaining; count++) {
            counts[stateIndex] = count;
            buildCountVectors(remaining - count, stateIndex + 1, counts);
        }
    }

    buildCountVectors(neighbor_count, 0, new Array(n_states).fill(0));
    // console.log(rule_map);

    // hack rule map: replace the class with all neighbors in state 0 to map to state 1
    rule_map.set('9,0,0', 1); // all neighbors in state 0 maps to state 1 (growth from empty)
    rule_map.set('0,9,0', 2); // all neighbors in state 1 maps to state 2 (growth from state 1)
    rule_map.set('0,0,9', 0); // all neighbors in state 2 maps to state 0 (growth from state 2)
    return rule_map;
}

// version 2
// function generateRules() {
//     // Using the sum of neighbor states as the key for the rule map,
//     // which reduces the number of keys to n_states * neighbor_count (e.g. 3*9=27 for n_states=3 and neighbor_count=9).
//     p_c_0 = 0.75 // probability of a class mapping to state 0 (empty)
//     let rule_map = new Map();
//     for (let sum = 0; sum <= neighbor_count * (n_states - 1); sum++) {
//         let value = Math.random() < p_c_0 ? 0 : 1 + Math.floor(Math.random() * (n_states - 1));
//         rule_map.set(sum.toString(), value);
//     }
//     // console.log(rule_map);
//     return rule_map;
// }

// // version 3
// function generateRules() {
//     // using majority voting
//     let rule_map = new Map();
// }

function convert2DneighborhoodTo1D(x, y, z) {
    // Encode neighborhood as counts per state (order-invariant key).
    let counts = new Array(n_states).fill(0);
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            let neighbor_x = wrapIndex(x + i, cols);
            let neighbor_y = wrapIndex(y + j, rows);
            let state = grid[neighbor_x][neighbor_y][z - 1].state;
            counts[state] += 1;
        }
    }
    return counts.join(',');
}

// convert the rule map from a base n_states number to a base 10 number and print it
function printRuleMapAsNumber() {
    let rule = "";
    for (let [key, value] of rule_map) {
        rule += value.toString();
    }
    // console.log(`Rule number (base ${n_states}): ${rule}`);
    let rule_number = parseInt(rule, n_states);
    // console.log(`Rule number (decimal): ${rule_number}`);
}
printRuleMapAsNumber();

function d4Representative(i, j, size) {
    const transforms = [
        [i, j],
        [j, size - 1 - i],
        [size - 1 - i, size - 1 - j],
        [size - 1 - j, i],
        [i, size - 1 - j],
        [size - 1 - i, j],
        [j, i],
        [size - 1 - j, size - 1 - i]
    ];

    let best = transforms[0];
    let bestKey = best[0] * size + best[1];
    for (let k = 1; k < transforms.length; k++) {
        const candidate = transforms[k];
        const key = candidate[0] * size + candidate[1];
        if (key < bestKey) {
            best = candidate;
            bestKey = key;
        }
    }
    return best;
}

// // initialize the first layer (depth = 0) of the grid with random states
// function initializeGrid() {
//     for (let i = 0; i < Math.floor(cols); i++) {
//         for (let j = 0; j < Math.floor(rows); j++) {
//             let x = i * cell_size;
//             let y = j * cell_size;
//             let randomn = Math.floor(Math.random() * n_states);
//             grid[i][j][0] = new Cell(x, y, 0, randomn);
//         }
//     }
// }

// initialize the first layer (depth = 0) with a repeating n*n seed matrix
function initializeGrid() {
    // initialize the first layer (depth = 0) with the first state (empty)
    initial_layer = Math.floor(Math.random() * n_states);
    for (let i = 0; i < Math.floor(cols); i++) {
        for (let j = 0; j < Math.floor(rows); j++) {
            let x = i * cell_size;
            let y = j * cell_size;
            grid[i][j][0] = new Cell(x, y, 0, initial_layer);
        }
    }
    const pattern_size = 4;
    const tiled_size = pattern_size * 2;
    // Build one random matrix, then project each cell to a canonical D4 orbit representative.
    const seed = new Array(tiled_size)
    .fill(null)
    .map(() => new Array(tiled_size).fill(null).map(() => Math.floor(Math.random() * n_states)));
    const seed_d4 = new Array(tiled_size)
    .fill(null)
    .map(() => new Array(tiled_size).fill(0));
    for (let i = 0; i < tiled_size; i++) {
        for (let j = 0; j < tiled_size; j++) {
            const rep = d4Representative(i, j, tiled_size);
            seed_d4[i][j] = seed[rep[0]][rep[1]];
        }
    }

    // console.log("Initial D4 seed matrix:", seed_d4);
    
    // // Tile the seed matrix across the full x/y plane at z=0.
    // for (let i = 0; i < cols; i++) {
    //     for (let j = 0; j < rows; j++) {
    //         const x = i * cell_size;
    //         const y = j * cell_size;
    //         const state = seed[i % pattern_size][j % pattern_size];
    //         grid[i][j][0] = new Cell(x, y, 0, state);
    //     }
    // }

    // // Tile the seed matrix only in the center of the x/y plane at z=0, leaving the borders empty.
    // const x_offset = Math.floor((cols - pattern_size) / 2);
    // const y_offset = Math.floor((rows - pattern_size) / 2);
    // for (let i = 0; i < pattern_size; i++) {
    //     for (let j = 0; j < pattern_size; j++) {
    //         const x = (x_offset + i) * cell_size;
    //         const y = (y_offset + j) * cell_size;
    //         const state = seed[i][j];
    //         grid[x_offset + i][y_offset + j][0] = new Cell(x, y, 0, state);
    //     }
    // }

    // // Place the centered D4-symmetric seed block.
    // const x_offset = Math.floor((cols - tiled_size) / 2);
    // const y_offset = Math.floor((rows - tiled_size) / 2);
    // for (let i = 0; i < tiled_size; i++) {
    //     for (let j = 0; j < tiled_size; j++) {
    //         const x = (x_offset + i) * cell_size;
    //         const y = (y_offset + j) * cell_size;
    //         const state = seed_d4[i][j];
    //         grid[x_offset + i][y_offset + j][0] = new Cell(x, y, 0, state);
    //     }
    // }

    // Place the D4-symmetric block at the corners, leaving the center empty.
    const x_offset = Math.floor((cols - tiled_size) / 2);
    const y_offset = Math.floor((rows - tiled_size) / 2);
    for (let i = 0; i < tiled_size; i++) {
        for (let j = 0; j < tiled_size; j++) {
            const state = seed_d4[i][j];
            grid[i][j][0] = new Cell(i * cell_size, j * cell_size, 0, state); // top-left
            grid[cols - tiled_size + i][j][0] = new Cell((cols - tiled_size + i) * cell_size, j * cell_size, 0, state); // top-right
            grid[i][rows - tiled_size + j][0] = new Cell(i * cell_size, (rows - tiled_size + j) * cell_size, 0, state); // bottom-left
            grid[cols - tiled_size + i][rows - tiled_size + j][0] = new Cell((cols - tiled_size + i) * cell_size, (rows - tiled_size + j) * cell_size, 0, state); // bottom-right
        }
    }
}

// console.log("Initial grid:", grid);

function drawLayer(zIndex) {
    noStroke();
    noLights();
    ambientLight(255);
    // pointLight(255, 127, 127, 0, 300, 300);
    push();
    rotateX(-PI / 6);
    rotateY(PI / 3);
    for (let i = 0; i < Math.floor(cols); i++) {
        for (let j = 0; j < Math.floor(rows); j++) {
            const cell = grid[i][j][zIndex];
            if (!cell) {
                continue;
            }

            const x = cell.x - (cols * cell_size) / 2 + cell_size / 2;
            const y = cell.y - (rows * cell_size) / 2 + cell_size / 2;
            const z = cell.z * cell_size - (depth * cell_size) / 2;

            push();
            fill(colors[cell.state]);
            translate(x, y, z);
            box(cell_size, cell_size, cell_size);
            pop();
        }
    }
    pop();
}

function setup() {
    createCanvas(cols * cell_size * 3, rows * cell_size * 3, WEBGL);
    ortho(-480, 480, 480, -480, -2000, 2000);
    background(10);
    initializeGrid();
    drawLayer(0);
    time_step += 1;
    setTimeout(() => {
        nextFrame();
    }, time_interval);
}

function nextFrame() {
    // update state function
    updateState();
    drawLayer(time_step);
    time_step += 1;
    if (time_step < depth) {
        setTimeout(nextFrame, time_interval);
    }
    // else if (time_step === rows) {
    //     setTimeout(() => {
    //         // rerun the simulation after it finishes
    //         time_step = 0;
    //         colors = getRandomColor();
    //         rule_map = generateRules();
    //         initializeGrid();
    //         drawGrid();
    //         time_step += 1;
    //         setTimeout(nextFrame, time_interval);
    //     }, time_interval*50); // wait for 10 seconds before resetting the grid
    // }
}

function wrapIndex(idx, max) {
    if (idx >= 0 && idx < max) {
        return idx;
    } else {
        return (idx + max) % max;
    }
}

function updateState() {
    // create a new z-layer from the previous z-layer
    let z = time_step;
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let x = i * cell_size;
            let y = j * cell_size;

            // // use 3x3 neighborhood from layer z-1 to compute state at layer z
            
            // use the sum of neighbor states as the key for the rule map
            // let neighbor_sum = 0;
            // for (let di = -1; di <= 1; di++) {
            //     for (let dj = -1; dj <= 1; dj++) {
            //         let neighbor_x = wrapIndex(i + di, cols);
            //         let neighbor_y = wrapIndex(j + dj, rows);
            //         let state = grid[neighbor_x][neighbor_y][z - 1].state;
            //         neighbor_sum += state;
            //     }
            // }
            // let neighbor_states = neighbor_sum.toString();
            // console.log(`Neighbor states for cell (${i}, ${j}, ${z}):`, neighbor_states);
            
            let neighbor_states = convert2DneighborhoodTo1D(i, j, z);
            let new_state = rule_map.get(neighbor_states);
            if (new_state === undefined) {
                // Fallback for neighborhood keys missing in the simplified rule map.
                new_state = Math.floor(Math.random() * n_states);
            }
            // console.log(`New state for cell (${i}, ${j}, ${z}):`, new_state);
            const new_cell = new Cell(x, y, z, new_state);
            grid[i][j][z] = new_cell;
        }
    }
}

// // button to reset the grid
// function keyPressed() {
//     if (key === 'r' || key === 'R') {
//         time_step = 0;
//         initializeGrid();
//         drawGrid();
//     }
// }