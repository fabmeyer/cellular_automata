// Edit this object, then reload the page. No other file needs configuration.
const CONFIG = {
    grid: { cols: 96, rows: 96, baseDepth: 192, cellSize: 4 },
    simulation: { algorithm: "PN", states: 9, timeInterval: 1 },
    ca: {
        rule: "majority", // "counts", "sum", "majority"
        neighborhoodSize: 9, // odd side length; includes the center cell
        emptyStateProbability: 0.67, // shared by counts and sum
        cycleUniform: { counts: false, sum: false, majority: true }
    },
    pn: {
        forwardProbability: 0.1,
        noiseSpaceScale: 0.01,
        noiseTimeScale: 0.01
    },
    initial: {
        mode: "seed", // "random" plane or reusable "seed"
        patternSize: 32,
        symmetry: "plain", // "plain", "D4"
        placement: "tiled" // "tiled", "center", "corners"
    },
    memory: {
        enabled: true,
        capacityMultiplier: 2, // capacity = multiplier * states squared
        matchRunFraction: 0.5
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
        background: 10,
        emptyColor: "rgba(0, 0, 0, 0.05)",
        occupiedAlpha: 0.95
    }
};

function resolveConfig(config) {
    function requireValue(condition, message) {
        if (!condition) {
            throw new Error(message);
        }
    }
    function positiveInteger(value, name) {
        requireValue(Number.isSafeInteger(value) && value > 0, `${name} must be a positive safe integer`);
    }
    function positiveNumber(value, name) {
        requireValue(Number.isFinite(value) && value > 0, `${name} must be a positive finite number`);
    }
    function probability(value, name) {
        requireValue(Number.isFinite(value) && value >= 0 && value <= 1,
            `${name} must be a finite number between 0 and 1`);
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
    requireValue(Number.isInteger(simulation.states) && simulation.states >= 2 && simulation.states <= 9,
        "simulation.states must be an integer between 2 and 9");
    requireValue(Number.isFinite(simulation.timeInterval) && simulation.timeInterval >= 0 &&
        simulation.timeInterval <= 2147483647, "simulation.timeInterval must be between 0 and 2147483647 ms");

    choice(initial.mode, ["random", "seed"], "initial.mode");
    if (initial.mode === "seed") {
        positiveInteger(initial.patternSize, "initial.patternSize");
        requireValue(initial.patternSize <= grid.cols && initial.patternSize <= grid.rows,
            "initial.patternSize must fit within both grid dimensions");
        choice(initial.symmetry, ["plain", "D4"], "initial.symmetry");
        choice(initial.placement, ["tiled", "center", "corners"], "initial.placement");
    }
    if (simulation.algorithm === "CA") {
        const { ca } = config;
        choice(ca.rule, ["counts", "sum", "majority"], "ca.rule");
        positiveInteger(ca.neighborhoodSize, "ca.neighborhoodSize");
        requireValue(ca.neighborhoodSize % 2 === 1, "ca.neighborhoodSize must be odd");
        requireValue(Number.isSafeInteger(ca.neighborhoodSize ** 2 * (simulation.states - 1)),
            "ca.neighborhoodSize is too large for exact state sums");
        requireValue(typeof ca.cycleUniform[ca.rule] === "boolean", "ca.cycleUniform for the selected rule must be boolean");
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
        preset.rotation.every(Number.isFinite), "view rotation must contain three finite multiples of PI");
    positiveNumber(view.cameraPadding, "view.cameraPadding");
    requireValue(view.cameraPadding >= 1, "view.cameraPadding must be at least 1");
    probability(view.occupiedAlpha, "view.occupiedAlpha");
    requireValue(typeof view.emptyColor === "string" && view.emptyColor.length > 0,
        "view.emptyColor must be a nonempty p5 color string");
    requireValue(Number.isFinite(view.background) && view.background >= 0 && view.background <= 255,
        "view.background must be between 0 and 255");
    const depth = grid.baseDepth * preset.depthMultiplier;
    positiveInteger(depth, "effective depth");
    const canvasWidth = Math.ceil(grid.cols * grid.cellSize * preset.canvasScale[0]);
    const canvasHeight = Math.ceil(grid.rows * grid.cellSize * preset.canvasScale[1]);
    positiveInteger(canvasWidth, "canvas width");
    positiveInteger(canvasHeight, "canvas height");
    requireValue(Number.isFinite(Math.hypot(grid.cols, grid.rows, depth) * grid.cellSize * view.cameraPadding),
        "grid and view dimensions must produce finite camera bounds");
    return { ...config, depth, preset, canvasWidth, canvasHeight, memoryCapacity, matchRunLength };
}
