/**
 * Per-frame invariant evaluation over TileTable telemetry + probe state.
 *
 * Every invariant maps to a shipped bug (see spec/validation-gym.md). All
 * checks are time-windowed — "drains within N frames", never "same frame" —
 * because GPU scheduling varies across machines and a flaky gym is a dead
 * gym.
 */
import type { TileTableTelemetry } from '../quadtree/tileTable';
import type { GymProbeState } from './probe';

export type GymViolation = {
    invariant: string;
    frame: number;
    message: string;
};

export type GymFrameInput = {
    frame: number;
    telemetry: TileTableTelemetry;
    /** Draw rows for this frame (prefix of table.drawRows). */
    drawRows: ArrayLike<number>;
    drawRowCount: number;
    /** True while scenario inputs (camera/probe position) changed this frame. */
    inputsChanged: boolean;
    probe?: GymProbeState;
    /** Analytic ground truth at the probe's position (world meters). */
    trueGroundY?: number;
    /** Terrain query report used by the probe this frame. */
    querySample?: { valid: boolean; elevation: number };
};

export type GymInvariantOptions = {
    /** Frames allowed for notReady/dirty backlogs to drain after inputs settle. */
    drainWindowFrames?: number;
    /** Re-entry within this window after leaving the draw set counts as flicker. */
    flickerWindowFrames?: number;
    /** Flicker is only evaluated while inputs are at rest. */
    epsilonMeters?: number;
    /** Frames allowed for ground validity to appear after probe placement. */
    groundAppearWindowFrames?: number;
    /**
     * Frames at run start during which truth-based checks (probe-grounding,
     * query-truthfulness) are skipped: cold-start LOD refinement legitimately
     * serves coarse-leaf elevations with meter-scale interpolation error until
     * the quadtree converges around the spawn point.
     */
    warmupFrames?: number;
    /** Cap on stored violations (counts keep accumulating). */
    maxStoredViolations?: number;
};

const DEFAULTS: Required<GymInvariantOptions> = {
    drainWindowFrames: 90,
    flickerWindowFrames: 30,
    epsilonMeters: 0.75,
    groundAppearWindowFrames: 120,
    warmupFrames: 0,
    maxStoredViolations: 50,
};

export type GymInvariantSummary = {
    name: string;
    pass: boolean;
    violationCount: number;
};

export type GymTelemetrySummary = {
    maxNotReady: number;
    framesToDrainNotReady: number;
    maxDirtyBacklog: number;
    framesToDrainDirty: number;
    flickerEvents: number;
    overflowTotal: number;
    probeMaxPenetration: number;
    probeFramesToGround: number;
    queryMaxTruthError: number;
};

export type GymInvariantEvaluator = {
    evaluateFrame(input: GymFrameInput): void;
    finish(): {
        ok: boolean;
        invariants: GymInvariantSummary[];
        violations: GymViolation[];
        totalViolationCount: number;
        telemetry: GymTelemetrySummary;
    };
};

export function createGymInvariantEvaluator(
    options: GymInvariantOptions = {}
): GymInvariantEvaluator {
    const opts = { ...DEFAULTS, ...options };
    const violations: GymViolation[] = [];
    const counts = new Map<string, number>();

    const record = (invariant: string, frame: number, message: string) => {
        counts.set(invariant, (counts.get(invariant) ?? 0) + 1);
        if (violations.length < opts.maxStoredViolations) {
            violations.push({ invariant, frame, message });
        }
    };

    // Drainage tracking: frames since inputs last changed, and backlog values.
    let framesSinceInputChange = 0;
    let maxNotReady = 0;
    let maxDirty = 0;
    let notReadyDrainFrames = 0;
    let dirtyDrainFrames = 0;
    let lastNotReadyNonZeroRun = 0;
    let lastDirtyNonZeroRun = 0;

    // Flicker tracking: when each row last left the draw set, and rest state.
    const lastSeenFrame = new Map<number, number>();
    const lastExitFrame = new Map<number, number>();
    let flickerEvents = 0;
    const currentRows = new Set<number>();

    // Probe tracking.
    let probeMaxPenetration = 0;
    let probeFramesToGround = -1;
    let queryMaxTruthError = 0;

    let overflowTotal = 0;

    const evaluateFrame = (input: GymFrameInput): void => {
        const t = input.telemetry;

        // draw-readiness: identity must hold every frame on gated pipelines.
        if (t.visibleReadyCount + t.fallbackVisibleCount !== t.visibleSlotCount) {
            record(
                'draw-readiness',
                input.frame,
                `ready ${t.visibleReadyCount} + fallback ${t.fallbackVisibleCount} !== drawn ${t.visibleSlotCount}`
            );
        }

        // overflow-absence.
        if (t.overflowCount > 0) {
            overflowTotal += t.overflowCount;
            record('overflow-absence', input.frame, `overflowCount=${t.overflowCount}`);
        }

        // Drainage windows.
        framesSinceInputChange = input.inputsChanged ? 0 : framesSinceInputChange + 1;

        maxNotReady = Math.max(maxNotReady, t.notReadyVisibleCount);
        if (t.notReadyVisibleCount > 0) {
            lastNotReadyNonZeroRun += 1;
            notReadyDrainFrames = Math.max(notReadyDrainFrames, lastNotReadyNonZeroRun);
            if (framesSinceInputChange > opts.drainWindowFrames) {
                record(
                    'not-ready-drainage',
                    input.frame,
                    `notReadyVisibleCount=${t.notReadyVisibleCount} after ${framesSinceInputChange} settled frames`
                );
            }
        } else {
            lastNotReadyNonZeroRun = 0;
        }

        const dirtyBacklog = t.dirtyResidentCount;
        maxDirty = Math.max(maxDirty, dirtyBacklog);
        if (dirtyBacklog > 0) {
            lastDirtyNonZeroRun += 1;
            dirtyDrainFrames = Math.max(dirtyDrainFrames, lastDirtyNonZeroRun);
            if (framesSinceInputChange > opts.drainWindowFrames) {
                record(
                    'dirty-drainage',
                    input.frame,
                    `dirty backlog ${dirtyBacklog} after ${framesSinceInputChange} settled frames`
                );
            }
        } else {
            lastDirtyNonZeroRun = 0;
        }

        // draw-stability: a row re-entering the draw set shortly after leaving
        // it while the camera is at rest is flicker.
        currentRows.clear();
        for (let i = 0; i < input.drawRowCount; i += 1) {
            currentRows.add(input.drawRows[i] as number);
        }
        const atRest = framesSinceInputChange > 0;
        for (const row of currentRows) {
            const exitedAt = lastExitFrame.get(row);
            if (
                atRest &&
                exitedAt !== undefined &&
                input.frame - exitedAt <= opts.flickerWindowFrames
            ) {
                flickerEvents += 1;
                record(
                    'draw-stability',
                    input.frame,
                    `row ${row} re-entered draw set ${input.frame - exitedAt} frames after leaving`
                );
            }
            lastExitFrame.delete(row);
            lastSeenFrame.set(row, input.frame);
        }
        for (const [row, seenAt] of lastSeenFrame) {
            if (seenAt !== input.frame) {
                lastExitFrame.set(row, input.frame);
                lastSeenFrame.delete(row);
            }
        }

        // Probe invariants (when the scenario runs one). Truth-based checks
        // honor the warmup window (cold-start LOD refinement).
        const inWarmup = input.frame < opts.warmupFrames;
        const probe = input.probe;
        if (!inWarmup && probe && typeof input.trueGroundY === 'number') {
            if (probe.groundKnown) {
                const penetration = input.trueGroundY - probe.y;
                if (penetration > probeMaxPenetration) probeMaxPenetration = penetration;
                if (penetration > opts.epsilonMeters) {
                    record(
                        'probe-grounding',
                        input.frame,
                        `probe ${penetration.toFixed(2)}m below analytic ground`
                    );
                }
            } else if (probe.framesSincePlaced > opts.groundAppearWindowFrames) {
                record(
                    'query-truthfulness',
                    input.frame,
                    `no valid ground ${probe.framesSincePlaced} frames after placement`
                );
            }
            if (probe.framesToGround >= 0) {
                probeFramesToGround = Math.max(probeFramesToGround, probe.framesToGround);
            }
        }

        // query-truthfulness: valid samples must match analytic truth.
        if (
            !inWarmup &&
            input.querySample?.valid &&
            typeof input.trueGroundY === 'number' &&
            Number.isFinite(input.querySample.elevation)
        ) {
            const error = Math.abs(input.querySample.elevation - input.trueGroundY);
            if (error > queryMaxTruthError) queryMaxTruthError = error;
            if (error > opts.epsilonMeters) {
                record(
                    'query-truthfulness',
                    input.frame,
                    `valid sample off truth by ${error.toFixed(2)}m`
                );
            }
        }
    };

    const finish = () => {
        const names = [
            'draw-readiness',
            'not-ready-drainage',
            'dirty-drainage',
            'probe-grounding',
            'query-truthfulness',
            'draw-stability',
            'overflow-absence',
        ];
        const invariants = names.map((name) => ({
            name,
            pass: (counts.get(name) ?? 0) === 0,
            violationCount: counts.get(name) ?? 0,
        }));
        let totalViolationCount = 0;
        for (const count of counts.values()) totalViolationCount += count;
        return {
            ok: totalViolationCount === 0,
            invariants,
            violations,
            totalViolationCount,
            telemetry: {
                maxNotReady,
                framesToDrainNotReady: notReadyDrainFrames,
                maxDirtyBacklog: maxDirty,
                framesToDrainDirty: dirtyDrainFrames,
                flickerEvents,
                overflowTotal,
                probeMaxPenetration,
                probeFramesToGround,
                queryMaxTruthError,
            },
        };
    };

    return { evaluateFrame, finish };
}
