// Edit this object, then reload the page. No other file needs configuration.
const CONFIG = {
    grid: {
        factor: 2,
        get cols() { return 96 * this.factor; },
        get rows() { return 96 * this.factor; },
        get baseDepth() { return 192 * this.factor; },
        cellSize: 4
    },
    simulation: {
        algorithm: "PN", // "CA", "PN"
        get states() { return Math.min(8, CONFIG.initial.patternSize); },
        timeInterval: 1
    },
    ca: {
        rule: "sum", // "counts", "sum", "majority"
        neighborhoodSize: 3, // odd side length; includes the center cell
        emptyStateProbability: 0.5, // shared by counts and sum
        cycleUniform: true
    },
    pn: {
        forwardProbability: 0.99999,
        noiseSpaceScale: 0.0005,
        noiseTimeScale: 0.00001
    },
    initial: {
        mode: "seed", // "random" plane or reusable "seed"
        patternSize: 32,
        symmetry: "D4", // "plain", "D4"
        placement: "tiled", // "tiled", "center", "corners"
        loopPattern: true // corners only: repeat the seed instead of empty (state 0) surroundings; center and tiled always loop
    },
    memory: {
        enabled: true, // CA counts/sum rules can change repeatedly; PN and majority are observational only
        capacityMultiplier: 1, // state-based history = multiplier * states squared; history is at least depth / 4
        matchRunFraction: 1 // fraction of state-based history required as consecutive matches (at most depth / 4 for periods up to depth / 4)
    },
    view: {
        orientation: "sideways", // "sideways", "vertical"
        presets: {
            sideways: {
                depthMultiplier: 1,
                canvasScale: [3, 3],
                rotation: [-1 / 6, 1 / 3, 0] // multiples of PI
            },
            vertical: {
                depthMultiplier: 2,
                canvasScale: [4, 8],
                rotation: [2 / 3, 1, -1 / 3]
            }
        },
        cameraPadding: 1.05, // margin around the tightly fitted block; larger zooms out
        background: 10
    }
};

const INT32_MAX = 2147483647;
const FLOAT32_MAX = 3.4028234663852886e38;

function resolveConfig(config) {
    function requireValue(condition, message) {
        if (!condition) {
            throw new Error(message);
        }
    }
    function int32(value) {
        return Number.isInteger(value) && value >= -INT32_MAX - 1 && value <= INT32_MAX;
    }
    function float32(value) {
        return Number.isFinite(value) && Math.abs(value) <= FLOAT32_MAX;
    }
    function positiveInteger(value, name) {
        requireValue(int32(value) && value > 0, `${name} must be a positive 32-bit integer`);
    }
    function positiveNumber(value, name) {
        requireValue(float32(value) && value > 0, `${name} must be a positive finite 32-bit float`);
    }
    function probability(value, name) {
        requireValue(float32(value) && value >= 0 && value <= 1,
            `${name} must be a finite 32-bit float between 0 and 1`);
    }
    function choice(value, options, name) {
        requireValue(options.includes(value), `${name} must be one of: ${options.join(", ")}`);
    }

    const { grid, simulation, initial, view, memory } = config;
    positiveInteger(grid.cols, "grid.cols");
    positiveInteger(grid.rows, "grid.rows");
    positiveInteger(grid.baseDepth, "grid.baseDepth");
    positiveNumber(grid.cellSize, "grid.cellSize");
    choice(simulation.algorithm, ["CA", "PN"], "simulation.algorithm");
    requireValue(int32(simulation.states) && simulation.states >= 2 && simulation.states <= 9,
        "simulation.states must be an integer between 2 and 9");
    requireValue(float32(simulation.timeInterval) && simulation.timeInterval >= 0 &&
        simulation.timeInterval <= INT32_MAX, "simulation.timeInterval must be between 0 and 2147483647 ms");

    choice(initial.mode, ["random", "seed"], "initial.mode");
    if (initial.mode === "seed") {
        positiveInteger(initial.patternSize, "initial.patternSize");
        requireValue(initial.patternSize <= grid.cols && initial.patternSize <= grid.rows,
            "initial.patternSize must fit within both grid dimensions");
        choice(initial.symmetry, ["plain", "D4"], "initial.symmetry");
        choice(initial.placement, ["tiled", "center", "corners"], "initial.placement");
        if (initial.placement === "corners") {
            requireValue(typeof initial.loopPattern === "boolean", "initial.loopPattern must be true or false");
        }
    }
    if (simulation.algorithm === "CA") {
        const { ca } = config;
        choice(ca.rule, ["counts", "sum", "majority"], "ca.rule");
        positiveInteger(ca.neighborhoodSize, "ca.neighborhoodSize");
        requireValue(ca.neighborhoodSize % 2 === 1, "ca.neighborhoodSize must be odd");
        requireValue(int32(ca.neighborhoodSize ** 2 * (simulation.states - 1)),
            "ca.neighborhoodSize is too large for signed 32-bit state sums");
        requireValue(typeof ca.cycleUniform === "boolean", "ca.cycleUniform must be boolean");
        if (ca.rule !== "majority") {
            probability(ca.emptyStateProbability, "ca.emptyStateProbability");
        }
    } else {
        probability(config.pn.forwardProbability, "pn.forwardProbability");
        positiveNumber(config.pn.noiseSpaceScale, "pn.noiseSpaceScale");
        positiveNumber(config.pn.noiseTimeScale, "pn.noiseTimeScale");
    }
    requireValue(typeof memory.enabled === "boolean", "memory.enabled must be boolean");
    let memoryCapacity = 0;
    let matchRunLength = 0;
    if (memory.enabled) {
        positiveInteger(memory.capacityMultiplier, "memory.capacityMultiplier");
        memoryCapacity = memory.capacityMultiplier * simulation.states ** 2;
        positiveInteger(memoryCapacity, "memory capacity");
        probability(memory.matchRunFraction, "memory.matchRunFraction");
        requireValue(memory.matchRunFraction > 0, "memory.matchRunFraction must be greater than 0");
        matchRunLength = Math.max(1, Math.floor(memoryCapacity * memory.matchRunFraction));
    }
    choice(view.orientation, ["sideways", "vertical"], "view.orientation");
    const preset = view.presets[view.orientation];
    positiveInteger(preset.depthMultiplier, "view depthMultiplier");
    requireValue(Array.isArray(preset.canvasScale) && preset.canvasScale.length === 2,
        "view canvasScale must contain two numbers");
    preset.canvasScale.forEach(value => positiveNumber(value, "view canvasScale"));
    requireValue(Array.isArray(preset.rotation) && preset.rotation.length === 3 &&
        preset.rotation.every(float32), "view rotation must contain three finite float32 multiples of PI");
    positiveNumber(view.cameraPadding, "view.cameraPadding");
    requireValue(view.cameraPadding >= 1, "view.cameraPadding must be at least 1");
    requireValue(float32(view.background) && view.background >= 0 && view.background <= 255,
        "view.background must be between 0 and 255");
    const depth = grid.baseDepth * preset.depthMultiplier;
    positiveInteger(depth, "effective depth");
    if (memory.enabled) {
        memoryCapacity = Math.max(memoryCapacity, Math.floor(depth / 4));
    }
    const canvasWidth = Math.ceil(grid.cols * grid.cellSize * preset.canvasScale[0]);
    const canvasHeight = Math.ceil(grid.rows * grid.cellSize * preset.canvasScale[1]);
    positiveInteger(canvasWidth, "canvas width");
    positiveInteger(canvasHeight, "canvas height");
    requireValue(float32(Math.hypot(grid.cols, grid.rows, depth) * grid.cellSize * view.cameraPadding),
        "grid and view dimensions must produce finite float32 camera bounds");
    return { ...config, depth, preset, canvasWidth, canvasHeight, memoryCapacity, matchRunLength };
}
