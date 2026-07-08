/**
 * Gym scenario manifest + deterministic path generation and the paired
 * (GPU + CPU) analytic elevation the scenarios run on.
 *
 * Everything here is pure data/functions so hosts (the /gym page, the CDP
 * runner, tests) interpret one source of truth.
 */
import { cos, float, sin } from 'three/tsl';
import type { ElevationCallback } from '../tsl/elevation';
import type { GymInvariantOptions } from './invariants';
import { createGymRng, type GymRng } from './rng';

/**
 * Paired analytic elevation: the GPU (TSL) and CPU forms are the same closed
 * formula, so gym assertions compare against truth rather than
 * self-consistency. Prototype of the paired-elevation contract from
 * architecture-simplification.md Phase 3.
 */
export type GymElevation = {
    gpu: ElevationCallback;
    cpu: (x: number, z: number) => number;
    amplitude: number;
};

export function createGymSineElevation(amplitude = 24, frequency = 0.015): GymElevation {
    return {
        amplitude,
        cpu: (x: number, z: number) => amplitude * Math.sin(x * frequency) * Math.cos(z * frequency),
        gpu: ({ worldPosition }) =>
            sin(worldPosition.x.mul(float(frequency)))
                .mul(cos(worldPosition.z.mul(float(frequency))))
                .mul(float(amplitude)),
    };
}

export type GymPathPoint = { x: number; z: number };

/**
 * Seeded smooth random walk: fixed speed, heading noise per frame. Stays
 * within `extent` of the origin by steering back toward the center.
 */
export function generateSurfaceWalkPath(
    rng: GymRng,
    frames: number,
    speed: number,
    fixedDt: number,
    extent: number
): GymPathPoint[] {
    const points: GymPathPoint[] = [];
    let x = 0;
    let z = 0;
    let heading = rng() * Math.PI * 2;
    for (let i = 0; i < frames; i += 1) {
        heading += (rng() - 0.5) * 0.35;
        const distance = Math.hypot(x, z);
        if (distance > extent) {
            // Steer back toward the origin rather than clamping (keeps the
            // path smooth so movement never teleports implicitly).
            const homeward = Math.atan2(-z, -x);
            heading = heading * 0.7 + homeward * 0.3;
        }
        x += Math.cos(heading) * speed * fixedDt;
        z += Math.sin(heading) * speed * fixedDt;
        points.push({ x, z });
    }
    return points;
}

/** Seeded far-teleport targets within a square extent around the origin. */
export function generateTeleportTargets(
    rng: GymRng,
    count: number,
    extent: number,
    minJump: number
): GymPathPoint[] {
    const points: GymPathPoint[] = [];
    let last: GymPathPoint = { x: 0, z: 0 };
    for (let i = 0; i < count; i += 1) {
        let candidate: GymPathPoint = last;
        for (let attempt = 0; attempt < 16; attempt += 1) {
            candidate = { x: (rng() * 2 - 1) * extent, z: (rng() * 2 - 1) * extent };
            if (Math.hypot(candidate.x - last.x, candidate.z - last.z) >= minJump) break;
        }
        points.push(candidate);
        last = candidate;
    }
    return points;
}

export type GymScenario = {
    name: string;
    description: string;
    defaultSeed: number;
    frames: number;
    fixedDt: number;
    /** World config. */
    rootSize: number;
    maxNodes: number;
    maxLevel: number;
    innerTileSegments: number;
    /** Probe motion. */
    walkSpeed: number;
    walkExtent: number;
    teleportEveryFrames: number | null;
    teleportMinJump: number;
    /** Frames the scenario holds still at the end (rest-phase checks). */
    restFrames: number;
    invariantOptions: GymInvariantOptions;
};

export const GYM_SCENARIOS: readonly GymScenario[] = [
    {
        name: 'surface-walk',
        description:
            'Probe walks a seeded smooth path; catches holes, readiness breaks, and grounding drift while moving.',
        defaultSeed: 1337,
        frames: 1500,
        fixedDt: 1 / 60,
        rootSize: 2048,
        maxNodes: 1024,
        maxLevel: 10,
        innerTileSegments: 16,
        walkSpeed: 24,
        walkExtent: 700,
        teleportEveryFrames: null,
        teleportMinJump: 0,
        restFrames: 180,
        invariantOptions: { warmupFrames: 120 },
    },
    {
        name: 'teleport-shock',
        description:
            'Seeded far teleports every ~2 seconds; catches phantom ground, fall-through, and dirty-backlog loss.',
        defaultSeed: 4242,
        frames: 1200,
        fixedDt: 1 / 60,
        rootSize: 4096,
        maxNodes: 1024,
        maxLevel: 10,
        innerTileSegments: 16,
        walkSpeed: 8,
        walkExtent: 1600,
        teleportEveryFrames: 120,
        teleportMinJump: 600,
        restFrames: 180,
        invariantOptions: { groundAppearWindowFrames: 150, warmupFrames: 120 },
    },
    {
        name: 'rest-stability',
        description:
            'Brief walk, then hold still; flicker and backlogs must go to zero. Catches LOD oscillation.',
        defaultSeed: 7,
        frames: 900,
        fixedDt: 1 / 60,
        rootSize: 2048,
        maxNodes: 1024,
        maxLevel: 10,
        innerTileSegments: 16,
        walkSpeed: 24,
        walkExtent: 400,
        teleportEveryFrames: null,
        teleportMinJump: 0,
        restFrames: 600,
        invariantOptions: { flickerWindowFrames: 45, warmupFrames: 120 },
    },
] as const;

export function resolveGymScenario(name: string): GymScenario {
    const scenario = GYM_SCENARIOS.find((entry) => entry.name === name);
    if (!scenario) {
        const names = GYM_SCENARIOS.map((entry) => entry.name).join(', ');
        throw new Error(`Unknown gym scenario "${name}" (available: ${names})`);
    }
    return scenario;
}

/** Convenience: seeded motion plan for a scenario (walk path + teleports). */
export function buildGymMotionPlan(scenario: GymScenario, seed: number) {
    const rng = createGymRng(seed);
    const walkFrames = Math.max(0, scenario.frames - scenario.restFrames);
    const path = generateSurfaceWalkPath(
        rng,
        walkFrames,
        scenario.walkSpeed,
        scenario.fixedDt,
        scenario.walkExtent
    );
    const teleports = scenario.teleportEveryFrames
        ? generateTeleportTargets(
              rng,
              Math.ceil(walkFrames / scenario.teleportEveryFrames),
              scenario.walkExtent,
              scenario.teleportMinJump
          )
        : [];
    return { path, teleports };
}
