class Cell {
    constructor(x, y, size, state) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.state = state;
    }
}

function get_color_from_state(state) {
    if (state === 0) {
        return color("white");
    }
    if (state === 1) {
        return color("black");
    }
}

let cols = 10;
let rows = 10;

let cell_size = 20;
// create a 2D array with given number of columns and rows
let grid = new Array(cols).fill().map(() => new Array(rows));

function initializeGrid() {
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let x = i * cell_size;
            let y = j * cell_size;
            // let state = 0; // default state
            randomn = random(100);
            if (randomn < 10) {
                state = 1; // black
            } else {
                state = 0; // white
            }
            grid[i][j] = new Cell(x, y, cell_size, state);
        }
    }
}

function drawGrid() {
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let cell = grid[i][j];
            console.log(cell.state);
            fill(get_color_from_state(cell.state));
            rect(cell.x, cell.y, cell.size, cell.size);
        }
    }
}

function setup() {
    createCanvas(cols * cell_size, rows * cell_size);
    initializeGrid();
    drawGrid();
    setTimeout(nextFrame, 1000);
    nextFrame();
}

function nextFrame() {
    setTimeout(nextFrame, 1000); // call nextFrame every 1000 milliseconds
    // update state function
    updateState();
    drawGrid();
}

function updateState() {
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
            let cell = grid[i][j];
            // get all 8 neighbors
            let neighbors = [];
            for (let x = -1; x <= 1; x++) {
                for (let y = -1; y <= 1; y++) {
                    if (x === 0 && y === 0) continue; // skip the cell itself
                    let neighbor_x, neighbor_y;
                    // check if neighbor is not within bounds of the grid
                    if (i + x < 0 || i + x >= cols) {
                        neighbor_x = (i + x + cols) % cols; // wrap around horizontally
                    } else {
                        neighbor_x = i + x;
                    }
                    if (j + y < 0 || j + y >= rows) {
                        neighbor_y = (j + y + rows) % rows; // wrap around vertically
                    } else {
                        neighbor_y = j + y;
                    }
                    neighbors.push(grid[neighbor_x][neighbor_y]);
                }
            }

            // for testing only
            // randomn = random(100);
            // if (randomn < 10) {
            //     state = 1; // black
            // } else {
            //     state = 0; // white
            // }
            // cell.state = state;
        }
    }
}   

// function mouseMoved() {
//     if (mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) {
//         fill(random(255), random(255), random(255));
//         ellipse(mouseX, mouseY, 100, 100);
//     }
// }