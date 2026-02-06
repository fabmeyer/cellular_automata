class Cell {
    constructor(x, y, size, state, age) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.state = state;
        this.age = age;
    }
}

function get_color_from_state(state) {
    if (state === 0) {
        return color("white");
    }
    if (state === 1) {
        return color("black");
    }
    if (state === 2) {
        return color("red");
    }
}

// grid parameters
let cols = 100;
let rows = 100;
let cell_size = 5;

// create a 2D array with given number of columns and rows
let grid = new Array(cols).fill().map(() => new Array(rows));

// simulation parameters
let time_interval = 100;
let percent_alive = 0.25;
let max_age = 30;

function initializeGrid() {
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let x = i * cell_size;
            let y = j * cell_size;
            let state = 0; // default state
            let randomn = random(0, 99);
            if (randomn < percent_alive * 100) {
                state = 1; // black
            } else {
                state = 0; // white
            }
            grid[i][j] = new Cell(x, y, cell_size, state, 0);
        }
    }
}

function drawGrid() {
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let cell = grid[i][j];
            // console.log(cell.state);
            fill(get_color_from_state(cell.state));
            rect(cell.x, cell.y, cell.size, cell.size);
        }
    }
}

function setup() {
    createCanvas(cols * cell_size, rows * cell_size);
    initializeGrid();
    drawGrid();
    setTimeout(nextFrame, time_interval);
    nextFrame();
}

function nextFrame() {
    // update state function
    updateState();
    drawGrid();
    setTimeout(nextFrame, time_interval); // call nextFrame every 1000 milliseconds
}

function wrapIndex(idx, max) {
    return (idx + max) % max;
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
            for (let x = -1; x <= 1; x++) {
                for (let y = -1; y <= 1; y++) {
                    if (x === 0 && y === 0) continue; // skip the cell itself
                    const neighbor_x = wrapIndex(i + x, cols);
                    const neighbor_y = wrapIndex(j + y, rows);
                    neighbors.push(grid[neighbor_x][neighbor_y]);
                }
            }

            let [next_state, next_age] = rule(cell, neighbors);
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

function rule(cell, neighbors) {
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
    if (cell.state === 1 || cell.state === 2) {
        next_age += 1;
    } else if (cell.state === 0) {
        next_age = 0;
    }

    if (cell.state === 0) {
        next_age = 0;
        if (n_alive === 3) {
            next_state = 1;
        }
    }

    if (cell.state === 1) {
        next_age += 1;
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

    if (cell.state === 2) {
        next_age += 1;
        if (next_age >= max_age) {
        next_state = 0;
        } else {
            next_state = 2;
        }
    }

    return [next_state, next_age];
}

// function mouseMoved() {
//     if (mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) {
//         fill(random(255), random(255), random(255));
//         ellipse(mouseX, mouseY, 100, 100);
//     }
// }