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
            const ruleKeys = this.settings.simulation.algorithm === "CA"
                ? this.algorithm.lastLayerRuleKeys : null;
            const thresholdReached = this.memory.addLayer(this.grid, z, ruleKeys);
            const firstNotice = thresholdReached && !this.memory.notifiedPeriods.has(this.memory.latestPeriod);
            if (firstNotice) {
                console.log(`Memory repetition threshold reached at z=${z}; x=0 stripe period=${this.memory.latestPeriod}`);
                this.memory.markNotified();
            }
            if (thresholdReached && this.settings.simulation.algorithm === "CA") {
                const candidates = this.memory.latestRuleKeys.length > 0
                    ? this.memory.latestRuleKeys : ruleKeys.flat().filter(key => key !== null);
                const mutation = this.algorithm.mutateOneRule(candidates);
                if (mutation) {
                    console.log(`Memory changed CA rule ${mutation.key}: ${mutation.previousState} -> ${mutation.state}`);
                    this.memory = new RowMemory(this.settings);
                    this.memory.addLayer(this.grid, z);
                } else if (firstNotice) {
                    console.log("Memory could not change a rule: no non-uniform CA rule available to change in this layer.");
                }
            }
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
