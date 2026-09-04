import { describe, expect, it } from "vitest";
import { readbackNow, shouldScheduleReadback } from "./readback-schedule";

describe("shouldScheduleReadback", () => {
  it("never schedules when disabled", () => {
    expect(shouldScheduleReadback(1000, -Infinity, 0, false)).toBe(false);
    expect(shouldScheduleReadback(1000, 0, 0, false)).toBe(false);
    expect(shouldScheduleReadback(1000, 0, 16, false)).toBe(false);
  });

  it("always schedules with a zero or negative interval", () => {
    expect(shouldScheduleReadback(1000, 999, 0, true)).toBe(true);
    expect(shouldScheduleReadback(1000, 1000, 0, true)).toBe(true);
    expect(shouldScheduleReadback(1000, 999, -5, true)).toBe(true);
    expect(shouldScheduleReadback(1000, 999, Number.NaN, true)).toBe(true);
  });

  it("schedules the first readback regardless of interval", () => {
    expect(shouldScheduleReadback(0, -Infinity, 5000, true)).toBe(true);
  });

  it("throttles until the interval has elapsed", () => {
    expect(shouldScheduleReadback(1000, 1000, 100, true)).toBe(false);
    expect(shouldScheduleReadback(1050, 1000, 100, true)).toBe(false);
    expect(shouldScheduleReadback(1099, 1000, 100, true)).toBe(false);
    expect(shouldScheduleReadback(1100, 1000, 100, true)).toBe(true);
    expect(shouldScheduleReadback(5000, 1000, 100, true)).toBe(true);
  });

  it("treats an infinite interval as never re-scheduling after the first", () => {
    expect(shouldScheduleReadback(0, -Infinity, Infinity, true)).toBe(true);
    expect(shouldScheduleReadback(1e9, 0, Infinity, true)).toBe(true);
  });
});

describe("readbackNow", () => {
  it("returns a finite, non-decreasing timestamp", () => {
    const a = readbackNow();
    const b = readbackNow();
    expect(Number.isFinite(a)).toBe(true);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
