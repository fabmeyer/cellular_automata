// Edit this object, then reload the page. No other file needs configuration.
const CONFIG = {
    grid: {
        factor: 4.0,
        get cols() { return 96 * this.factor; },
        get rows() { return 96 * this.factor; },
        get baseDepth() { return 192 * this.factor; },
        cellSize: 4 // cube side and layer spacing in model units
    },
    simulation: {
        algorithm: "PN", // "CA", "PN"
        get states() { return Math.min(9, CONFIG.initial.patternSize); },
        get numGenerations() {
            return 2.0 * CONFIG.grid.baseDepth * CONFIG.view.presets[CONFIG.view.orientation].depthMultiplier;
        }, // includes the initial layer
        retainHistory: false, // true keeps all simulated layers in memory
        seed: 2709487604, // null generates and logs a fresh seed; set an unsigned 32-bit integer to replay a run
        timeInterval: 1
    },
    coloring: {
        state0Alpha: null, // null keeps algorithm default; otherwise 0 (transparent) to 1 (opaque)
        otherStatesAlpha: null, // null keeps algorithm default; otherwise 0 (transparent) to 1 (opaque)
        shading: 0.0 // directional face shading: 0 (flat colors) to 1 (strongest)
    },
    ca: {
        rule: "sum", // "counts", "sum", "majority"
        neighborhoodSize: 3, // odd side length; includes the center cell
        emptyStateProbability: 0.5, // shared by counts and sum
        cycleUniform: true
    },
    pn: {
        mode: "trajectory", // "legacy", "trajectory"
        boundary: "grow", // "wrap", "grow"
        movementUnit: 1, // null uses cellSize; otherwise a positive divisor of cellSize, e.g. 1
        slope: null, // shared [min, max] movement units per layer; null keeps each mode's existing speed
        maxCellsPerAxisPerLayer: 300, // integer
        forwardProbability: 1.0,
        noiseSpaceScale: 0.0075,
        noiseTimeScale: 0.0125,
        noiseDrift: [0.00125, 0.00125], // noise-coordinate units per layer along x/y
        noiseSteering: false,
        trajectory: {
            slope: [0.1, 0.5], // fallback when pn.slope is null; movement units per layer
            bend: [-0.025, 0.025], // change in slope per layer
            amplitude: [64, 256],
            wavelength: [128, 512],
            phase: [2*Math.PI, 2*Math.PI], // radians
            parameterNoise: {
                spaceScale: 0.0075,
                channels: "separate" // "separate", "shared"
            }
        }
    },
    initial: {
        mode: "seed", // "random", "seed"
        patternSize: 32,
        resolutionFactor: 2, // scaled block side must be a positive integer and divide the seed size
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
        orientation: "vertical", // "sideways", "vertical"
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
        zoom: 1.0, // values above 1 zoom in; values below 1 zoom out
        antialias: true,
        background: 10
    }
};

const INT32_MAX = 2147483647;
const FLOAT32_MAX = 3.4028234663852886e38;
const TRAJECTORY_PARAMETERS = ["slope", "bend", "amplitude", "wavelength", "phase"];

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
    function nonnegativeNumber(value, name) {
        requireValue(float32(value) && value >= 0, `${name} must be a nonnegative finite 32-bit float`);
    }
    function probability(value, name) {
        requireValue(float32(value) && value >= 0 && value <= 1,
            `${name} must be a finite 32-bit float between 0 and 1`);
    }
    function choice(value, options, name) {
        requireValue(options.includes(value), `${name} must be one of: ${options.join(", ")}`);
    }

    const { grid, simulation, view, memory, coloring } = config;
    const factor = Object.hasOwn(grid, "factor") ? grid.factor : 1;
    const seed = Object.hasOwn(simulation, "seed") ? simulation.seed : null;
    positiveNumber(factor, "grid.factor");
    requireValue(factor <= INT32_MAX, "grid.factor must not exceed 2147483647");
    const scale = (value, multiplier) => typeof value === "number" ? value * multiplier : value;
    const scaleRange = (range, multiplier) => Array.isArray(range)
        ? range.map(value => scale(value, multiplier)) : range;
    if (config.initial.mode === "seed") {
        positiveInteger(config.initial.patternSize, "initial.patternSize");
    }
    const initial = {
        ...config.initial,
        patternSize: scale(config.initial.patternSize, factor),
        resolutionFactor: scale(config.initial.resolutionFactor, factor)
    };
    let pn = config.pn;
    if (simulation.algorithm === "PN") {
        const movementUnit = Object.hasOwn(pn, "movementUnit") ? pn.movementUnit : null;
        const slope = Object.hasOwn(pn, "slope") ? pn.slope : null;
        if (slope !== null) {
            requireValue(Array.isArray(slope) && slope.length === 2 && slope.every(float32) &&
                slope[0] >= 0 && slope[0] <= slope[1],
                "pn.slope must be a nonnegative ordered pair of finite float32 numbers");
        }
        const noiseDrift = Object.hasOwn(pn, "noiseDrift") ? pn.noiseDrift : [0, 0];
        const noiseSteering = Object.hasOwn(pn, "noiseSteering") ? pn.noiseSteering : false;
        requireValue(Array.isArray(noiseDrift) && noiseDrift.length === 2 &&
            float32(noiseDrift[0]) && float32(noiseDrift[1]),
            "pn.noiseDrift must contain two finite float32 numbers");
        requireValue(typeof noiseSteering === "boolean", "pn.noiseSteering must be boolean");
        nonnegativeNumber(pn.noiseSpaceScale, "pn.noiseSpaceScale");
        nonnegativeNumber(pn.noiseTimeScale, "pn.noiseTimeScale");
        pn = {
            ...pn,
            movementUnit,
            slope,
            noiseDrift: scaleRange(noiseDrift, 1 / factor),
            noiseSteering,
            noiseSpaceScale: scale(pn.noiseSpaceScale, 1 / factor),
            noiseTimeScale: scale(pn.noiseTimeScale, 1 / factor)
        };
        if (pn.mode === "trajectory" && pn.trajectory && typeof pn.trajectory === "object") {
            const trajectory = { ...pn.trajectory, slope: slope ?? pn.trajectory.slope };
            for (const name of TRAJECTORY_PARAMETERS) {
                const range = trajectory[name];
                requireValue(Array.isArray(range) && range.length === 2 && range.every(float32) &&
                    range[0] <= range[1],
                    `pn.trajectory.${name} must be an ordered pair of finite float32 numbers`);
            }
            if (trajectory.parameterNoise && typeof trajectory.parameterNoise === "object") {
                nonnegativeNumber(trajectory.parameterNoise.spaceScale, "pn.trajectory.parameterNoise.spaceScale");
            }
            pn.trajectory = {
                ...trajectory,
                bend: scaleRange(trajectory.bend, 1 / factor),
                amplitude: scaleRange(trajectory.amplitude, factor),
                wavelength: scaleRange(trajectory.wavelength, factor),
                parameterNoise: trajectory.parameterNoise && typeof trajectory.parameterNoise === "object"
                    ? { ...trajectory.parameterNoise,
                        spaceScale: scale(trajectory.parameterNoise.spaceScale, 1 / factor) }
                    : trajectory.parameterNoise
            };
        }
    }
    positiveInteger(grid.cols, "grid.cols");
    positiveInteger(grid.rows, "grid.rows");
    positiveInteger(grid.baseDepth, "grid.baseDepth");
    positiveNumber(grid.cellSize, "grid.cellSize");
    choice(simulation.algorithm, ["CA", "PN"], "simulation.algorithm");
    for (const name of ["state0Alpha", "otherStatesAlpha"]) {
        if (coloring[name] !== null) {
            probability(coloring[name], `coloring.${name}`);
        }
    }
    if (Object.hasOwn(coloring, "shading")) {
        probability(coloring.shading, "coloring.shading");
    }
    requireValue(int32(simulation.states) && simulation.states >= 2 && simulation.states <= 9,
        "simulation.states must be an integer between 2 and 9");
    requireValue(typeof simulation.retainHistory === "boolean", "simulation.retainHistory must be boolean");
    requireValue(seed === null || (Number.isInteger(seed) &&
        seed >= 0 && seed <= 4294967295),
        "simulation.seed must be null or an unsigned 32-bit integer");
    requireValue(float32(simulation.timeInterval) && simulation.timeInterval >= 0 &&
        simulation.timeInterval <= INT32_MAX, "simulation.timeInterval must be between 0 and 2147483647 ms");

    choice(initial.mode, ["random", "seed"], "initial.mode");
    positiveInteger(initial.resolutionFactor, "initial.resolutionFactor");
    if (initial.mode === "seed") {
        positiveInteger(initial.patternSize, "initial.patternSize");
        requireValue(initial.patternSize <= grid.cols && initial.patternSize <= grid.rows,
            "initial.patternSize must fit within both grid dimensions");
        requireValue(initial.patternSize % initial.resolutionFactor === 0,
            "initial.resolutionFactor must divide initial.patternSize exactly");
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
    } else if (simulation.algorithm === "PN") {
        choice(pn.mode, ["legacy", "trajectory"], "pn.mode");
        choice(pn.boundary, ["wrap", "grow"], "pn.boundary");
        positiveInteger(pn.maxCellsPerAxisPerLayer, "pn.maxCellsPerAxisPerLayer");
        let ticksPerCell = 1;
        if (pn.movementUnit !== null) {
            positiveNumber(pn.movementUnit, "pn.movementUnit");
            requireValue(Math.fround(pn.movementUnit) > 0, "pn.movementUnit must be representable as a positive float32");
            ticksPerCell = grid.cellSize / pn.movementUnit;
            requireValue(Number.isSafeInteger(ticksPerCell) && ticksPerCell >= 1,
                "pn.movementUnit must divide grid.cellSize into a positive safe integer number of ticks");
            requireValue(Number.isSafeInteger(grid.cols * ticksPerCell) &&
                Number.isSafeInteger(grid.rows * ticksPerCell),
                "PN position dimensions exceed the safe integer range");
        }
        requireValue(Number.isSafeInteger(pn.maxCellsPerAxisPerLayer * ticksPerCell),
            "PN movement limit exceeds the safe integer range");
        pn = { ...pn, ticksPerCell };
        if (pn.mode === "legacy" && pn.slope !== null) {
            requireValue(pn.slope[1] <= pn.maxCellsPerAxisPerLayer * ticksPerCell,
                "pn.slope must not exceed pn.maxCellsPerAxisPerLayer in cellSize units");
        }
        probability(pn.forwardProbability, "pn.forwardProbability");
        nonnegativeNumber(pn.noiseSpaceScale, "pn.noiseSpaceScale");
        nonnegativeNumber(pn.noiseTimeScale, "pn.noiseTimeScale");
    }
    requireValue(typeof memory.enabled === "boolean", "memory.enabled must be boolean");
    let memoryCapacity = 0;
    let matchRunLength = 0;
    if (memory.enabled) {
        positiveInteger(memory.capacityMultiplier, "memory.capacityMultiplier");
        memoryCapacity = Math.max(1, Math.floor(memory.capacityMultiplier * simulation.states ** 2 * factor));
        positiveInteger(memoryCapacity, "memory capacity");
        probability(memory.matchRunFraction, "memory.matchRunFraction");
        requireValue(memory.matchRunFraction > 0, "memory.matchRunFraction must be greater than 0");
        matchRunLength = Math.max(1,
            Math.floor(memory.capacityMultiplier * simulation.states ** 2 * memory.matchRunFraction * factor));
        positiveInteger(matchRunLength, "memory match run length");
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
    positiveNumber(view.zoom, "view.zoom");
    requireValue(typeof view.antialias === "boolean", "view.antialias must be boolean");
    requireValue(float32(view.background) && view.background >= 0 && view.background <= 255,
        "view.background must be between 0 and 255");
    const depth = grid.baseDepth * preset.depthMultiplier;
    positiveInteger(depth, "effective depth");
    const generations = simulation.numGenerations;
    positiveInteger(generations, "simulation.numGenerations");
    requireValue(float32(generations * grid.cellSize),
        "simulation.numGenerations and grid.cellSize must produce finite float32 layer positions");
    if (simulation.algorithm === "PN" && pn.mode === "trajectory") {
        const trajectory = pn.trajectory;
        requireValue(trajectory && typeof trajectory === "object",
            "pn.trajectory must contain parameter ranges");
        for (const name of TRAJECTORY_PARAMETERS) {
            const range = trajectory[name];
            requireValue(Array.isArray(range) && range.length === 2 && range.every(float32) &&
                range[0] <= range[1],
                `pn.trajectory.${name} must be an ordered pair of finite float32 numbers`);
        }
        requireValue(trajectory.slope[0] >= 0, "pn.trajectory.slope must be nonnegative");
        requireValue(trajectory.amplitude[0] >= 0, "pn.trajectory.amplitude must be nonnegative");
        requireValue(trajectory.wavelength[0] > 0, "pn.trajectory.wavelength must be positive");
        requireValue(Number.isFinite(2 * Math.PI * Math.max(1, generations - 1) / trajectory.wavelength[0]),
            "pn.trajectory.wavelength is too small for finite curve evaluation");
        const parameterNoise = trajectory.parameterNoise;
        requireValue(parameterNoise && typeof parameterNoise === "object",
            "pn.trajectory.parameterNoise must contain spaceScale and channels");
        nonnegativeNumber(parameterNoise.spaceScale, "pn.trajectory.parameterNoise.spaceScale");
        choice(parameterNoise.channels, ["separate", "shared"], "pn.trajectory.parameterNoise.channels");
        const maxBend = Math.max(...trajectory.bend.map(Math.abs));
        const speedBound = trajectory.slope[1] + maxBend * (generations - 1) +
            2 * Math.PI * (trajectory.amplitude[1] / trajectory.wavelength[0]);
        console.log("PN trajectory movement bound (cells per axis per layer):", {
            speedBound: speedBound / pn.ticksPerCell,
            minimumIntegerLimit: Math.max(1, Math.ceil(speedBound / pn.ticksPerCell)),
            configuredLimit: pn.maxCellsPerAxisPerLayer,
            ...(pn.movementUnit !== null ? { movementUnit: pn.movementUnit, movementUnitSpeedBound: speedBound } : {}),
            numGenerations: generations
        });
        requireValue(speedBound <= pn.maxCellsPerAxisPerLayer * pn.ticksPerCell,
            `pn.trajectory speed bound ${speedBound} must not exceed pn.maxCellsPerAxisPerLayer ` +
            `(${pn.maxCellsPerAxisPerLayer}): maxSlope + maxAbsBend * (generations - 1) + ` +
            "2 * PI * maxAmplitude / minWavelength <= pn.maxCellsPerAxisPerLayer * ticksPerCell");
    }
    if (memory.enabled) {
        memoryCapacity = Math.max(memoryCapacity, Math.floor(depth / 4));
    }
    const canvasWidth = Math.ceil(grid.cols * grid.cellSize * preset.canvasScale[0]);
    const canvasHeight = Math.ceil(grid.rows * grid.cellSize * preset.canvasScale[1]);
    positiveInteger(canvasWidth, "canvas width");
    positiveInteger(canvasHeight, "canvas height");
    requireValue(float32(Math.hypot(grid.cols, grid.rows, depth) * grid.cellSize * view.cameraPadding),
        "grid and view dimensions must produce finite float32 camera bounds");
    return { ...config, initial, pn, simulation: { ...simulation, seed, numGenerations: generations }, depth, preset,
        canvasWidth, canvasHeight, memoryCapacity, matchRunLength };
}
