class Cell {
    constructor(x, y, state) {
        this.x = x;
        this.y = y;
        this.state = state;
    }
}

// grid parameters
const cols = 400;
const rows = 400;
const cell_size = 2;

// create a 2D array with given number of columns and rows
let grid = new Array(cols).fill().map(() => new Array(rows));

// simulation parameters
const time_interval = 20;
const n_states = 3; // number of different states
// assert n_states is less than 10, otherwise the rule map will be too large to handle
if (n_states >= 10) {
    throw new Error("n_states should be less than 10");
}
const neighborhood_width = 3; // 1d neighborhood width, should be an odd number
if (neighborhood_width % 2 === 0) {
    throw new Error("neighborhood_width should be an odd number");
}
let time_step = 0;

// create n different colors for different states
let colors = getRandomColor();
function getRandomColor() {
    let colors = [];
    for (let i = 0; i < n_states; i++) {
        const r = Math.floor(Math.random() * 255);
        const g = Math.floor(Math.random() * 255);
        const b = Math.floor(Math.random() * 255);
        colors.push(`rgb(${r}, ${g}, ${b})`);
    }
    console.log(colors);
    return colors;
}

// create n_states * neighborhood_width different rules for generation
// create a permutation with lenght = neighborhood_width and values = n_states
let rule_map = generateRules();
function generateRules() {
    // use a map to store the rules, the key is the state of the neighbors and the value is the next state
    let rule_map = new Map();
    for (let i = 0; i < Math.pow(n_states, neighborhood_width); i++) {
        let key = i.toString(n_states).padStart(neighborhood_width, '0');
        let value = Math.floor(Math.random() * n_states);
        rule_map.set(key, value);
    }
    console.log(rule_map);
    return rule_map;
}

function initializeGrid() {
    for (let i = 0; i < Math.floor(cols); i++) {
        let x = i * cell_size;
        let randomn = Math.floor(Math.random() * n_states);
        grid[i][0] = new Cell(x, 0, randomn);
    }
}

function drawGrid() {
    noStroke();
    for (let i = 0; i < Math.floor(cols); i++) {
        const cell = grid[i][time_step];
        fill(colors[cell.state]);
        rect(cell.x, cell.y, cell_size, cell_size);
    }
}

function setup() {
    createCanvas(cols * cell_size, rows * cell_size);
    initializeGrid();
    drawGrid();
    time_step += 1;
    setTimeout(() => {
        nextFrame();
    }, time_interval);
}

// // show time_step on the bottom of the canvas
// function draw() {
//     // clear the area where the time step is displayed
//     fill(color(255));
//     textAlign(LEFT, BOTTOM);
//     textFont("Helvetica");
//     textSize(16);
//     rect(0, height - 20, width, 20);
//     fill(color(0));
//     text(`time step: ${time_step}`, 8, height - 2);
// }

function nextFrame() {
    // update state function
    updateState();
    drawGrid();
    // filter(BLUR, 10);
    time_step += 1;
    if (time_step < rows) {
        setTimeout(nextFrame, time_interval); // call nextFrame every 1000 milliseconds
    } else if (time_step === rows) {
        setTimeout(() => {
            // rerun the simulation after it finishes
            time_step = 0;
            colors = getRandomColor();
            rule_map = generateRules();
            initializeGrid();
            drawGrid();
            time_step += 1;
            setTimeout(nextFrame, time_interval);
        }, time_interval*50); // wait for 10 seconds before resetting the grid
    }
}

function wrapIndex(idx, max) {
    if (idx >= 0 && idx < max) {
        return idx;
    } else {
        return (idx + max) % max;
    }
}

function updateState() {
    // create a new row
    let j = time_step;
    let half = (neighborhood_width - 1) / 2
    for (let i = 0; i < cols; i++) {
        // console.log(`Updating cell at (${i}, ${j})`);
        let x = i * cell_size;
        let y = j * cell_size;
        
        // get neighbor states from previous row
        let neighbor_states = '';
        for (let k = -half; k <= half; k++) {
            let neighbor_i = wrapIndex(i + k, cols);
            let neighbor_j = wrapIndex(j - 1, rows);
            neighbor_states += grid[neighbor_i][neighbor_j].state.toString();
        }
        let new_state = rule_map.get(neighbor_states);
        const new_cell = new Cell(x, y, new_state);
        grid[i][j] = new_cell;
    }
    // console.log(`New row at time step ${time_step}:`, new_row);
}

// // button to reset the grid
// function keyPressed() {
//     if (key === 'r' || key === 'R') {
//         time_step = 0;
//         initializeGrid();
//         drawGrid();
//     }
// }