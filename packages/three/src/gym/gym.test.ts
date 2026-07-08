import { describe, expect, it } from 'vitest';
import type { TileTableTelemetry } from '../quadtree/tileTable';
import { createGymInvariantEvaluator, type GymFrameInput } from './invariants';
import { createGymProbe, placeGymProbe, stepGymProbe } from './probe';
import { createGymRng } from './rng';
import {
    buildGymMotionPlan,
    createGymSineElevation,
    generateSurfaceWalkPath,
    generateTeleportTargets,
    GYM_SCENARIOS,
    resolveGymScenario,
} from './scenarios';

function telemetry(overrides: Partial<TileTableTelemetry> = {}): TileTableTelemetry {
    return {
        candidateCount: 0,
        visibleCount: 0,
        guardCount: 0,
        frustumCulledCount: 0,
        horizonCulledCount: 0,
        unculledCount: 0,
        visibleRatio: 0,
        visibleResidentCount: 0,
        anchorResidentCount: 0,
        residentCount: 0,
        anchorCount: 0,
        residentRatio: 0,
        visibleSlotCount: 0,
        residentSlotCount: 0,
        supportSlotCount: 0,
        activeSlotCount: 0,
        dirtyResidentCount: 0,
        dirtyVisibleCount: 0,
        reusedCount: 0,
        allocatedCount: 0,
        evictedCount: 0,
        retainedInactiveCount: 0,
        overflowCount: 0,
        dirtyResidentRatio: 0,
        dirtyVisibleRatio: 0,
        reuseRatio: 0,
        visibleReadyCount: 0,
        fallbackVisibleCount: 0,
        notReadyVisibleCount: 0,
        requeuedDirtyCount: 0,
        ...overrides,
    };
}

function frame(
    frameIndex: number,
    overrides: Partial<GymFrameInput> = {},
    telemetryOverrides: Partial<TileTableTelemetry> = {}
): GymFrameInput {
    return {
        frame: frameIndex,
        telemetry: telemetry(telemetryOverrides),
        drawRows: [],
        drawRowCount: 0,
        inputsChanged: false,
        ...overrides,
    };
}

describe('gym/rng', () => {
    it('is deterministic per seed and diverges across seeds', () => {
        const a1 = createGymRng(42);
        const a2 = createGymRng(42);
        const b = createGymRng(43);
        const seqA1 = [a1(), a1(), a1()];
        const seqA2 = [a2(), a2(), a2()];
        const seqB = [b(), b(), b()];
        expect(seqA1).toEqual(seqA2);
        expect(seqA1).not.toEqual(seqB);
        for (const value of seqA1) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });
});

describe('gym/probe', () => {
    it('holds vertical position until ground is first known', () => {
        const probe = createGymProbe(0, 50, 0);
        for (let i = 0; i < 30; i += 1) {
            stepGymProbe(probe, 0, 0, { valid: false, elevation: 0 });
        }
        expect(probe.y).toBe(50);
        expect(probe.groundKnown).toBe(false);
        expect(probe.framesToGround).toBe(-1);
    });

    it('falls and snaps onto ground once a valid sample appears', () => {
        const probe = createGymProbe(0, 20, 0);
        stepGymProbe(probe, 0, 0, { valid: true, elevation: 10 });
        expect(probe.groundKnown).toBe(true);
        expect(probe.framesToGround).toBe(1);
        for (let i = 0; i < 600; i += 1) {
            stepGymProbe(probe, 0, 0, { valid: true, elevation: 10 });
        }
        expect(probe.grounded).toBe(true);
        expect(probe.y).toBeCloseTo(10 + 1.2, 5);
    });

    it('teleport resets grounding to hold-until-valid', () => {
        const probe = createGymProbe(0, 20, 0);
        for (let i = 0; i < 300; i += 1) {
            stepGymProbe(probe, 0, 0, { valid: true, elevation: 0 });
        }
        expect(probe.grounded).toBe(true);

        placeGymProbe(probe, 500, 40, 500);
        expect(probe.groundKnown).toBe(false);
        for (let i = 0; i < 60; i += 1) {
            stepGymProbe(probe, 0, 0, { valid: false, elevation: 0 });
        }
        // Held in the air, not fallen through the void.
        expect(probe.y).toBe(40);
    });
});

describe('gym/invariants', () => {
    it('passes a clean steady-state run', () => {
        const evaluator = createGymInvariantEvaluator();
        for (let i = 0; i < 200; i += 1) {
            evaluator.evaluateFrame(
                frame(
                    i,
                    { drawRows: [1, 2, 3], drawRowCount: 3 },
                    {
                        visibleSlotCount: 3,
                        visibleReadyCount: 3,
                    }
                )
            );
        }
        const result = evaluator.finish();
        expect(result.ok).toBe(true);
        expect(result.totalViolationCount).toBe(0);
    });

    it('flags the draw-readiness identity breaking', () => {
        const evaluator = createGymInvariantEvaluator();
        evaluator.evaluateFrame(
            frame(0, {}, { visibleSlotCount: 4, visibleReadyCount: 2, fallbackVisibleCount: 1 })
        );
        const result = evaluator.finish();
        expect(result.ok).toBe(false);
        expect(result.invariants.find((i) => i.name === 'draw-readiness')?.pass).toBe(false);
    });

    it('flags a permanent notReady floor but tolerates transient bursts', () => {
        const evaluator = createGymInvariantEvaluator({ drainWindowFrames: 30 });
        // Burst while moving: fine.
        for (let i = 0; i < 20; i += 1) {
            evaluator.evaluateFrame(frame(i, { inputsChanged: true }, { notReadyVisibleCount: 2 }));
        }
        // Settles: backlog drains within the window.
        for (let i = 20; i < 40; i += 1) {
            evaluator.evaluateFrame(frame(i, {}, { notReadyVisibleCount: i < 30 ? 1 : 0 }));
        }
        expect(evaluator.finish().ok).toBe(true);

        const failing = createGymInvariantEvaluator({ drainWindowFrames: 30 });
        for (let i = 0; i < 80; i += 1) {
            failing.evaluateFrame(frame(i, {}, { notReadyVisibleCount: 1 }));
        }
        const result = failing.finish();
        expect(result.invariants.find((i) => i.name === 'not-ready-drainage')?.pass).toBe(false);
        expect(result.telemetry.maxNotReady).toBe(1);
    });

    it('flags a dirty backlog that never drains (lost work)', () => {
        const evaluator = createGymInvariantEvaluator({ drainWindowFrames: 20 });
        for (let i = 0; i < 60; i += 1) {
            evaluator.evaluateFrame(frame(i, {}, { dirtyResidentCount: 4 }));
        }
        const result = evaluator.finish();
        expect(result.invariants.find((i) => i.name === 'dirty-drainage')?.pass).toBe(false);
    });

    it('detects draw-set flicker at rest and ignores churn while moving', () => {
        const moving = createGymInvariantEvaluator({ flickerWindowFrames: 10 });
        for (let i = 0; i < 30; i += 1) {
            const rows = i % 2 === 0 ? [1] : [2];
            moving.evaluateFrame(frame(i, { drawRows: rows, drawRowCount: 1, inputsChanged: true }));
        }
        expect(moving.finish().invariants.find((i) => i.name === 'draw-stability')?.pass).toBe(true);

        const resting = createGymInvariantEvaluator({ flickerWindowFrames: 10 });
        for (let i = 0; i < 30; i += 1) {
            const rows = i % 4 < 2 ? [1] : [2];
            resting.evaluateFrame(frame(i, { drawRows: rows, drawRowCount: 1 }));
        }
        const result = resting.finish();
        expect(result.invariants.find((i) => i.name === 'draw-stability')?.pass).toBe(false);
        expect(result.telemetry.flickerEvents).toBeGreaterThan(0);
    });

    it('suppresses truth-based checks during the warmup window only', () => {
        const evaluator = createGymInvariantEvaluator({ epsilonMeters: 0.5, warmupFrames: 10 });
        // Coarse cold-start data: large truth error during warmup is legal.
        for (let i = 0; i < 10; i += 1) {
            evaluator.evaluateFrame(
                frame(i, { trueGroundY: 100, querySample: { valid: true, elevation: 3 } })
            );
        }
        expect(evaluator.finish().ok).toBe(true);

        const after = createGymInvariantEvaluator({ epsilonMeters: 0.5, warmupFrames: 10 });
        after.evaluateFrame(
            frame(10, { trueGroundY: 100, querySample: { valid: true, elevation: 3 } })
        );
        expect(after.finish().ok).toBe(false);
    });

    it('flags probe penetration below analytic ground', () => {
        const evaluator = createGymInvariantEvaluator({ epsilonMeters: 0.5 });
        const probe = createGymProbe(0, 5, 0);
        probe.groundKnown = true;
        evaluator.evaluateFrame(frame(0, { probe, trueGroundY: 10 }));
        const result = evaluator.finish();
        expect(result.invariants.find((i) => i.name === 'probe-grounding')?.pass).toBe(false);
        expect(result.telemetry.probeMaxPenetration).toBeCloseTo(5, 5);
    });

    it('flags valid query samples that disagree with truth (phantom ground)', () => {
        const evaluator = createGymInvariantEvaluator({ epsilonMeters: 0.5 });
        evaluator.evaluateFrame(
            frame(0, { trueGroundY: 100, querySample: { valid: true, elevation: 3 } })
        );
        const result = evaluator.finish();
        expect(result.invariants.find((i) => i.name === 'query-truthfulness')?.pass).toBe(false);
        expect(result.telemetry.queryMaxTruthError).toBeCloseTo(97, 5);
    });

    it('flags ground never appearing after placement', () => {
        const evaluator = createGymInvariantEvaluator({ groundAppearWindowFrames: 10 });
        const probe = createGymProbe(0, 5, 0);
        for (let i = 0; i < 20; i += 1) {
            stepGymProbe(probe, 0, 0, { valid: false, elevation: 0 });
            evaluator.evaluateFrame(frame(i, { probe, trueGroundY: 0 }));
        }
        const result = evaluator.finish();
        expect(result.invariants.find((i) => i.name === 'query-truthfulness')?.pass).toBe(false);
    });
});

describe('gym/scenarios', () => {
    it('sine elevation CPU form matches its own formula and stays in range', () => {
        const elevation = createGymSineElevation(24, 0.015);
        expect(elevation.cpu(0, 0)).toBe(0);
        for (const [x, z] of [
            [10, 20],
            [-333, 512],
            [1000, -1000],
        ] as const) {
            const value = elevation.cpu(x, z);
            expect(Math.abs(value)).toBeLessThanOrEqual(24);
            expect(value).toBe(24 * Math.sin(x * 0.015) * Math.cos(z * 0.015));
        }
    });

    it('walk paths are deterministic, continuous, and bounded', () => {
        const a = generateSurfaceWalkPath(createGymRng(9), 500, 24, 1 / 60, 300);
        const b = generateSurfaceWalkPath(createGymRng(9), 500, 24, 1 / 60, 300);
        expect(a).toEqual(b);
        const maxStep = (24 * 1) / 60 + 1e-9;
        for (let i = 1; i < a.length; i += 1) {
            const step = Math.hypot(a[i]!.x - a[i - 1]!.x, a[i]!.z - a[i - 1]!.z);
            expect(step).toBeLessThanOrEqual(maxStep);
        }
        // Bounded: the walk steers home, allow a lenient margin over extent.
        for (const point of a) {
            expect(Math.hypot(point.x, point.z)).toBeLessThan(300 * 1.5);
        }
    });

    it('teleport targets respect the minimum jump distance', () => {
        const targets = generateTeleportTargets(createGymRng(5), 10, 1500, 600);
        let last = { x: 0, z: 0 };
        for (const target of targets) {
            expect(Math.hypot(target.x - last.x, target.z - last.z)).toBeGreaterThanOrEqual(600);
            last = target;
        }
    });

    it('resolves scenarios and builds deterministic motion plans', () => {
        expect(() => resolveGymScenario('nope')).toThrow(/available/);
        for (const scenario of GYM_SCENARIOS) {
            const planA = buildGymMotionPlan(scenario, scenario.defaultSeed);
            const planB = buildGymMotionPlan(scenario, scenario.defaultSeed);
            expect(planA.path.length).toBe(scenario.frames - scenario.restFrames);
            expect(planA).toEqual(planB);
        }
    });
});
