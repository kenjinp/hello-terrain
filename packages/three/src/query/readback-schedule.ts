/**
 * Pure gating logic for `terrainReadbackTask`.
 *
 * Kept free of graph/renderer dependencies so the throttle can be unit-tested
 * in isolation and reused by any task that schedules GPU→CPU readbacks.
 */

/** Monotonic-ish timestamp in ms; falls back to `Date.now()` outside browsers. */
export function readbackNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Decide whether a readback may be scheduled right now.
 *
 * - `enabled === false` never schedules.
 * - `intervalMs <= 0` (or non-finite) schedules whenever asked.
 * - Otherwise requires `now - lastScheduledAt >= intervalMs`; a `lastScheduledAt`
 *   of `-Infinity` (never scheduled) always passes.
 */
export function shouldScheduleReadback(
  now: number,
  lastScheduledAt: number,
  intervalMs: number,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  if (!(intervalMs > 0) || !Number.isFinite(intervalMs)) return true;
  if (!Number.isFinite(lastScheduledAt)) return true;
  return now - lastScheduledAt >= intervalMs;
}
