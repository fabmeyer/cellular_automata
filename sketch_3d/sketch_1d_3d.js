class Simulation {
    constructor(config, random = Math.random, noiseField = globalThis.noise) {
        this.settings = resolveConfig(config);
        this.random = random;
        this.grid = createGrid(this.settings);
        this.algorithm = this.settings.simulation.algorithm === "CA"
            ? new CellularAutomaton(this.settings, random)
            : new PerlinMovement(this.settings, random, noiseField);
        this.memory = null;
        this.nextZ = 0;
    }

    initialize() {
        initializeGrid(this.grid, this.settings, this.random);
        this.algorithm.initialize(this.grid);
        this.memory = this.settings.memory.enabled ? new RowMemory(this.settings) : null;
        if (this.memory) {
            this.memory.addLayer(this.grid, 0);
        }
        this.nextZ = 1;
    }

    step() {
        if (this.nextZ === 0) {
            throw new Error("Initialize the simulation before stepping");
        }
        if (this.nextZ >= this.settings.depth) {
            return null;
        }
        const z = this.nextZ;
        this.algorithm.step(this.grid, z);
        if (this.memory) {
            this.memory.addLayer(this.grid, z);
            this.memory.compareLatestRow();
        }
        this.nextZ++;
        return z;
    }
}

let simulation;
let renderer;

function setup() {
    simulation = new Simulation(CONFIG);
    renderer = new GridRenderer(simulation.settings);
    renderer.setup();
    simulation.initialize();
    renderer.drawLayer(simulation.grid, 0);
    if (simulation.nextZ < simulation.settings.depth) {
        setTimeout(nextFrame, simulation.settings.simulation.timeInterval);
    }
}

function nextFrame() {
    const z = simulation.step();
    if (z !== null) {
        renderer.drawLayer(simulation.grid, z);
    }
    if (simulation.nextZ < simulation.settings.depth) {
        setTimeout(nextFrame, simulation.settings.simulation.timeInterval);
    }
}
