function createSeededRandom(seed) {
    let state = seed;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

class Simulation {
    constructor(config, random, noiseField = globalThis.noise) {
        this.settings = resolveConfig(config);
        this.random = random ?? (this.settings.simulation.seed === null
            ? Math.random : createSeededRandom(this.settings.simulation.seed));
        this.grid = createGrid(this.settings);
        this.algorithm = this.settings.simulation.algorithm === "CA"
            ? new CellularAutomaton(this.settings, this.random)
            : new PerlinMovement(this.settings, this.random, noiseField);
        this.memory = null;
        this.nextZ = 0;
    }

    initialize() {
        this.grid.reset();
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
        if (this.nextZ >= this.settings.simulation.numGenerations) {
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
        if (!this.settings.simulation.retainHistory) {
            this.grid.releaseLayer(z - 1);
            if (this.grid.outsideLayers) {
                this.grid.outsideLayers[z - 1] = null;
            }
        }
        this.nextZ++;
        return z;
    }
}

let simulation;
let renderer;

globalThis.simulationDone = false;
globalThis.simulationError = null;
let nextProgressPercent = 10;
let frameTimer = null;

function recordSimulationError(error) {
    globalThis.simulationDone = false;
    globalThis.simulationError = error instanceof Error ? error.stack : String(error);
    if (frameTimer !== null) {
        clearTimeout(frameTimer);
        frameTimer = null;
    }
}

function reportSimulationProgress() {
    if (typeof globalThis.onSimulationProgress !== "function") {
        return;
    }
    const completed = simulation.nextZ;
    const total = simulation.settings.simulation.numGenerations;
    const percent = Math.floor(completed * 100 / total);
    if (completed !== 1 && percent < nextProgressPercent) {
        return;
    }
    nextProgressPercent = (Math.floor(percent / 10) + 1) * 10;
    const memory = globalThis.performance?.memory;
    globalThis.onSimulationProgress({
        percent, completed, total,
        heap: memory ? {
            usedBytes: memory.usedJSHeapSize,
            allocatedBytes: memory.totalJSHeapSize,
            limitBytes: memory.jsHeapSizeLimit
        } : null
    });
}

function logSimulationSettings(settings, coloring, seedSource) {
    const { grid, simulation, initial, memory, view } = settings;
    const initialSettings = {
        mode: initial.mode,
        resolutionFactor: initial.resolutionFactor
    };
    if (initial.mode === "seed") {
        Object.assign(initialSettings, {
            patternSize: initial.patternSize,
            symmetry: initial.symmetry,
            placement: initial.placement
        });
        if (initial.placement === "corners") {
            initialSettings.loopPattern = initial.loopPattern;
        }
    }
    let algorithmSettings;
    if (simulation.algorithm === "CA") {
        const { rule, neighborhoodSize, cycleUniform, emptyStateProbability } = settings.ca;
        algorithmSettings = { rule, neighborhoodSize, cycleUniform };
        if (rule !== "majority") {
            algorithmSettings.emptyStateProbability = emptyStateProbability;
        }
    } else {
        const { mode, boundary, movementUnit, slope, maxCellsPerAxisPerLayer, forwardProbability,
            noiseSpaceScale, noiseTimeScale, noiseDrift, noiseSteering, trajectory } = settings.pn;
        algorithmSettings = {
            mode, boundary, maxCellsPerAxisPerLayer, forwardProbability, noiseSpaceScale, noiseTimeScale,
            noiseDrift, noiseSteering, movementUnit: movementUnit ?? grid.cellSize,
            slope: mode === "trajectory" ? trajectory.slope : slope ?? [maxCellsPerAxisPerLayer, maxCellsPerAxisPerLayer],
            positionMode: movementUnit !== null,
            maxModelUnitsPerAxisPerLayer: maxCellsPerAxisPerLayer * grid.cellSize
        };
        if (mode === "trajectory") {
            const { slope, bend, amplitude, wavelength, phase, parameterNoise } = trajectory;
            algorithmSettings.trajectory = {
                slope, bend, amplitude, wavelength, phase,
                parameterNoise: { spaceScale: parameterNoise.spaceScale, channels: parameterNoise.channels }
            };
        }
    }
    const memorySettings = { enabled: memory.enabled };
    if (memory.enabled) {
        const quarterDepth = Math.floor(settings.depth / 4);
        Object.assign(memorySettings, {
            capacityMultiplier: memory.capacityMultiplier,
            matchRunFraction: memory.matchRunFraction,
            capacity: settings.memoryCapacity,
            matchRunLength: settings.matchRunLength,
            quarterDepth,
            shortPeriodMatchRunLength: quarterDepth > 0
                ? Math.min(settings.matchRunLength, quarterDepth) : settings.matchRunLength
        });
    }
    const record = {
        timestamp: new Date().toISOString(),
        grid: { factor: Object.hasOwn(grid, "factor") ? grid.factor : 1,
            cols: grid.cols, rows: grid.rows, baseDepth: grid.baseDepth, cellSize: grid.cellSize },
        simulation: {
            algorithm: simulation.algorithm, states: simulation.states, numGenerations: simulation.numGenerations,
            retainHistory: simulation.retainHistory, seed: simulation.seed, seedSource,
            timeInterval: simulation.timeInterval
        },
        algorithm: algorithmSettings,
        initial: initialSettings,
        memory: memorySettings,
        coloring,
        view: {
            orientation: view.orientation, depthMultiplier: settings.preset.depthMultiplier,
            canvasScale: settings.preset.canvasScale, rotation: settings.preset.rotation,
            cameraPadding: view.cameraPadding, zoom: view.zoom, antialias: view.antialias,
            background: view.background, depth: settings.depth,
            canvasWidth: settings.canvasWidth, canvasHeight: settings.canvasHeight,
            glow: view.glow
        }
    };
    console.log("Simulation settings:", JSON.stringify(record));
}

function setup() {
    try {
        const simulationConfig = { ...CONFIG.simulation };
        const configuredSeed = Object.hasOwn(simulationConfig, "seed") ? simulationConfig.seed : null;
        const seedSource = configuredSeed === null ? "generated" : "configured";
        simulationConfig.seed = configuredSeed === null
            ? Math.floor(Math.random() * 4294967296) : configuredSeed;
        simulation = new Simulation({ ...CONFIG, simulation: simulationConfig });
        const seed = simulation.settings.simulation.seed;
        if (typeof globalThis.noiseSeed !== "function") {
            throw new Error("A seeded simulation requires p5 noiseSeed");
        }
        globalThis.noiseSeed(seed);
        renderer = new GridRenderer(simulation.settings, globalThis, createSeededRandom(seed));
        logSimulationSettings(simulation.settings, renderer.coloring, seedSource);
        renderer.setup(error => {
            recordSimulationError(error);
            console.error(error);
        });
        simulation.initialize();
        renderer.drawLayer(simulation.grid, 0);
        renderer.assertContext();
        if (globalThis.simulationError !== null) {
            return;
        }
        reportSimulationProgress();
        if (simulation.nextZ < simulation.settings.simulation.numGenerations) {
            frameTimer = setTimeout(nextFrame, simulation.settings.simulation.timeInterval);
        } else {
            finishSimulation();
        }
    } catch (error) {
        recordSimulationError(error);
        throw error;
    }
}

function finishSimulation() {
    renderer.finish();
    if (globalThis.simulationError === null) {
        globalThis.simulationDone = true;
    }
}

function nextFrame() {
    frameTimer = null;
    if (globalThis.simulationError !== null) {
        return;
    }
    try {
        renderer.assertContext();
        const z = simulation.step();
        if (z !== null) {
            renderer.drawLayer(simulation.grid, z);
            renderer.assertContext();
            if (globalThis.simulationError !== null) {
                return;
            }
            reportSimulationProgress();
        }
        if (simulation.nextZ < simulation.settings.simulation.numGenerations) {
            frameTimer = setTimeout(nextFrame, simulation.settings.simulation.timeInterval);
        } else {
            finishSimulation();
        }
    } catch (error) {
        recordSimulationError(error);
        throw error;
    }
}
