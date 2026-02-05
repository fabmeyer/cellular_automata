class Cell {
    constructor(x, y, size, color) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.color = color;
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
            let color = 127; // default grey color
            grid[i][j] = new Cell(x, y, cell_size, color);
        }
    }
}

function drawGrid() {
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let cell = grid[i][j];
            fill(cell.color);
            rect(cell.x, cell.y, cell.size, cell.size);
        }
    }
}

// function draw() {
//     background(127);
// }

function setup() {
    createCanvas(cols * cell_size, rows * cell_size);
    // draw();
    initializeGrid();
    drawGrid();
    nextFrame();
}

function nextFrame() {
    // update state function
    updateState();
    drawGrid();
    setTimeout(nextFrame, 500); // call nextFrame every 500 milliseconds
}

function updateState() {
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            let cell = grid[i][j];
            // Randomly change color to black or white
            if (random(1) < 0.5) {
                cell.color = color("red"); // black
            } else {
                cell.color = color("blue"); // white
            }
        }
    }
}
    

// function mouseMoved() {
//     if (mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) {
//         fill(random(255), random(255), random(255));
//         ellipse(mouseX, mouseY, 100, 100);
//     }
// }