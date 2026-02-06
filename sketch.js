class Cell {
    constructor(x, y, size, state, age) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.state = state;
        this.age = age;
    }
}

// grid parameters
let cols = 200;
let rows = 200;
let cell_size = 5;

// create a 2D array with given number of columns and rows
let grid = new Array(cols).fill().map(() => new Array(rows));

// simulation parameters
let time_step = 0;
let time_interval = 10;
let percent_alive = 10;
let max_age = 64;

function initializeGrid() {
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let x = i * cell_size;
            let y = j * cell_size;
            let state = 0; // default state
            let randomn = random(0, 99);
            if (randomn < percent_alive) {
                state = 1; // black
            } else {
                state = 0; // white
            }
            grid[i][j] = new Cell(x, y, cell_size, state, 0);
        }
    }
}

function drawGrid() {
    noStroke();
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const cell = grid[i][j];
            // console.log(cell.state);
            if (cell.state === 0) {
                fill("white");
            } else if (cell.state === 1) {
                fill("black");
            } else if (cell.state === 2) {
                fill("red");
            } else if (cell.state === 3) {
                fill("orange");
            }
            rect(cell.x, cell.y, cell.size, cell.size);
        }
    }
}

function setup() {
    createCanvas(cols * cell_size, (rows * cell_size) + 20); // extra space for time step display
    initializeGrid();
    drawGrid();
    nextFrame();
}

// show time_step on the bottom of the canvas
function draw() {
    // clear the area where the time step is displayed
    fill(color(255));
    textAlign(LEFT, BOTTOM);
    textFont("Helvetica");
    textSize(16);
    rect(0, height - 20, width, 20);
    fill(color(0));
    text(`Time Step: ${time_step}`, 8, height - 2);
}

function nextFrame() {
    // update state function
    updateState();
    drawGrid();
    // filter(BLUR, 10);
    time_step += 1;
    setTimeout(nextFrame, time_interval); // call nextFrame every 1000 milliseconds
}

function wrapIndex(idx, max) {
    if (idx >= 0 && idx < max) {
        return idx;
    } else {
        return (idx + max) % max;
    }
}

function updateState() {
    let new_grid = new Array(cols).fill().map(() => new Array(rows));
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let cell = grid[i][j];
            // copy current cell to new cell
            let new_cell = new Cell(cell.x, cell.y, cell.size, cell.state, cell.age);
            // get all 8 neighbors
            let neighbors = [];
            let above = wrapIndex(j - 1, rows);
            let cell_above = grid[i][above];
            let below = wrapIndex(j + 1, rows);
            let cell_below = grid[i][below];
            let left = wrapIndex(i - 1, cols);
            let cell_left = grid[left][j];
            let right = wrapIndex(i + 1, cols);
            let cell_right = grid[right][j];
            for (let x = -1; x <= 1; x++) {
                for (let y = -1; y <= 1; y++) {
                    if (x === 0 && y === 0) continue; // skip the cell itself
                    const neighbor_x = wrapIndex(i + x, cols);
                    const neighbor_y = wrapIndex(j + y, rows);
                    neighbors.push(grid[neighbor_x][neighbor_y]);
                }
            }

            let [next_state, next_age] = rule(cell, neighbors, cell_above, cell_below, cell_left, cell_right);
            new_cell.state = next_state;
            new_cell.age = next_age;

            new_grid[i][j] = new_cell;
            // for testing only
            // let randomn = random(100);
            // if (randomn < percent_alive * 100) {
            //     state = 1; // black
            // } else {
            //     state = 0; // white
            // }
            // cell.state = state;
        }
    }
    grid = new_grid;
}

function rule(cell, neighbors, cell_above, cell_below, cell_left, cell_right) {
    let randomn = random(0, 99);

    // implement your rule here
    let n_alive = 0;
    for (let k = 0; k < neighbors.length; k++) {
        if (neighbors[k].state === 1) {
            n_alive += 1;
        }
    }

    let next_state = 0;
    let next_age = cell.age;

    // update age
    if (cell.state === 1 || cell.state === 2 || cell.state === 3) {
        next_age += 1;
    } else if (cell.state === 0) {
        next_age = 0;
    }

    // update state
    // Rule 1
    if (cell.state === 0) {
        next_age = 0;
        if (n_alive === 3) {
            next_state = 1;
        }
        // if (cell_below.state === 2 && randomn < 50) {
        //     next_state = 2;
        // }
        // if (cell_left.state === 2 && cell_right.state === 2) {
        //     next_state = 2;
        // }
    }

    // Rule 2
    if (cell.state === 1) {
        if (n_alive === 2 || n_alive === 3) {
            next_state = 1;
        } else {
            next_state = 0;
        }
        if (next_age >= max_age) {
            next_state = 2;
            next_age = 0;
        }
    }

    // Rule 3
    if (cell.state === 2) {
        next_state = 2;
        if (next_age >= max_age) {
            next_state = 3;
            next_age = 0;
        }
        // if (cell_above.state == 2 && randomn >= 90) {
        //     next_state = 0;
        // }
    }

    // Rule 4
    if (cell.state === 3) {
        next_state = 3;
        if (next_age >= max_age) {
        next_state = 0;
        next_age = 0;
        }
    }

    // Rule 5
    if ((cell_above.state === 3 || cell_below.state === 3) || (cell_left.state === 3 || cell_right.state === 3)) {
        next_state = 1;
        next_age = 0;
    }

    return [next_state, next_age];
}

// function mouseMoved() {
//     if (mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) {
//         // get cell coordinates
//         let i = Math.floor(mouseX / cell_size);
//         let j = Math.floor(mouseY / cell_size);
//         let cell = grid[i][j];
//         cell.state = 1; // set to alive
//         cell.age = 0;
//         drawGrid();
//     }
// }

// button to reset the grid
function keyPressed() {
    if (key === 'r' || key === 'R') {
        time_step = 0;
        initializeGrid();
        drawGrid();
    }
}