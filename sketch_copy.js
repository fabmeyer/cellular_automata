class Cell {
    constructor(x, y, state) {
        this.x = x;
        this.y = y;
        this.state = state;
    }
}

// grid parameters
const cols = 500;
const rows = 500;
const cell_size = 2;

// create a 2D array with given number of columns and rows
let grid = new Array(cols).fill().map(() => new Array(rows));

// simulation parameters
const time_interval = 5;
const n_states = 4; // number of different states
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

// convert the rule map from a base n_states number to a base 10 number and print it
function printRuleMapAsNumber() {
    let rule = "";
    for (let [key, value] of rule_map) {
        rule += value.toString();
    }
    console.log(`Rule number (base ${n_states}): ${rule}`);
    let rule_number = parseInt(rule, n_states);
    console.log(`Rule number (decimal): ${rule_number}`);
}
printRuleMapAsNumber();

function initializeGrid() {
    for (let i = 0; i < Math.floor(cols); i++) {
        let x = i * cell_size;
        let randomn = Math.floor(Math.random() * n_states);
        grid[i][0] = new Cell(x, 0, randomn);
    }
}

function initializeGrid() {
    let data = [];
    // use a data_length, such that rows % data_length != 0 to introduce inferences at the boundaries of the grid
    let data_length = 8;
    for (let i = 0; i < data_length; i++) {
        data.push(Math.floor(Math.random() * n_states));
    }
    console.log("Initial data:", data);
    for (let i = 0; i < Math.floor(cols/2); i += data_length) {
        for (let j = 0; j < data_length && i + j < cols; j++) {
            const cell = new Cell((i + j) * cell_size, 0, data[j]);
            grid[i + j][0] = cell;
        }
    }
    // flip the data for the second half of the grid to introduce more diversity
    data.reverse();
    // start from the end of the second half of the grid to introduce inferences at the boundaries of the grid
    for (let i = cols - 1; i >= Math.floor(cols/2); i -= data_length) {
        for (let j = 0; j < data_length && i - j >= 0; j++) {
            const cell = new Cell((i - j) * cell_size, 0, data[j]);
            grid[i - j][0] = cell;
        }
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
        // let new_state = (parseInt(neighbor_states, n_states) + grid[wrapIndex(i, cols)][wrapIndex(j - 1, rows)].state) % n_states;
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