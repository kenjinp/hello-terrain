import { describe, expect, it } from "vitest";
import {
  createRaycastCases,
  createRaycastFixture,
  raycastScenarioIds,
  validateRaycastResult,
} from "./raycast";

describe("seeded public raycast stress", () => {
  it("replays inputs exactly and rejects invalid workloads", () => {
    expect(createRaycastCases("sphere", 7, 16)).toEqual(createRaycastCases("sphere", 7, 16));
    expect(createRaycastCases("sphere", 8, 16)).not.toEqual(createRaycastCases("sphere", 7, 16));
    expect(() => createRaycastCases("sphere", -1, 1)).toThrow();
    expect(() => createRaycastCases("sphere", 7, 0)).toThrow();
  });

  it.each(raycastScenarioIds)(
    "%s validates both public calls and pinned leases",
    async (scenario) => {
      const fixture = await createRaycastFixture(scenario);
      const lease = fixture.runtime.query.acquireSnapshot()!;
      try {
        for (const ray of createRaycastCases(scenario, 7, 96)) {
          for (const query of [fixture.runtime.query, lease]) {
            fixture.resetSampleCount();
            const result = query.raycast(ray.origin, ray.direction, ray.options);
            expect(validateRaycastResult(ray, result, lease.revision), ray.id).toEqual([]);
            expect(fixture.sampleCount()).toBeLessThanOrEqual(ray.options.maxSteps!);
            expect(fixture.sampleCount()).toBeGreaterThan(0);
          }
        }
      } finally {
        lease.release();
        await fixture.dispose();
      }
    },
  );

  it("does not disguise thin features and late crossings as misses", async () => {
    for (const scenario of ["thin-ridge", "late-bracket", "flat-away"] as const) {
      const fixture = await createRaycastFixture(scenario);
      try {
        const ray = createRaycastCases(scenario, 7, 1)[0]!;
        const result = fixture.runtime.query.raycast(ray.origin, ray.direction, ray.options);
        expect(validateRaycastResult(ray, result), ray.id).toEqual([]);
        if (scenario === "flat-away")
          expect(result).toEqual({ status: "incomplete", reason: "work-budget" });
        // Thin and late crossings may improve to valid hits without breaking this test.
        // Validation still rejects false hits, wrong roots, and invalid incomplete reasons.
      } finally {
        await fixture.dispose();
      }
    }
  });

  it("detects corrupted results rather than accepting existing output as its oracle", async () => {
    const fixture = await createRaycastFixture("flat-down");
    try {
      const ray = createRaycastCases("flat-down", 7, 1)[0]!;
      const hit = fixture.runtime.query.raycast(ray.origin, ray.direction, ray.options);
      expect(hit.status).toBe("hit");
      if (hit.status !== "hit") throw new Error("Required hit");
      expect(validateRaycastResult(ray, hit)).toEqual([]);
      for (const bad of [
        { ...hit, distance: hit.distance + 1 },
        { ...hit, distance: NaN },
        { ...hit, sample: { ...hit.sample, position: [0, 100, 0] as [number, number, number] } },
        { ...hit, sample: { ...hit.sample, normal: [0, -1, 0] as [number, number, number] } },
      ])
        expect(validateRaycastResult(ray, bad).length).toBeGreaterThan(0);
      expect(
        validateRaycastResult(ray, hit, { ...hit.sample.revision, editVersion: -1 }),
      ).toContain("snapshot revision");
      expect(validateRaycastResult({ ...ray, expectedDistance: null }, hit)).toContain(
        "unexpected hit",
      );
      expect(
        validateRaycastResult(ray, { status: "incomplete", reason: "work-budget" }).length,
      ).toBeGreaterThan(0);
    } finally {
      await fixture.dispose();
    }
  });

  it("bounds actual sampling and validates inputs at both entry points", async () => {
    const fixture = await createRaycastFixture("flat-down");
    const lease = fixture.runtime.query.acquireSnapshot()!;
    try {
      for (const query of [fixture.runtime.query, lease]) {
        for (const maxSteps of [2, 16, 64, 256, 1024]) {
          fixture.resetSampleCount();
          const result = query.raycast([0, 10, 0], [0, 1, 0], { far: 20, maxSteps });
          expect(result).toEqual({ status: "incomplete", reason: "work-budget" });
          expect(fixture.sampleCount()).toBe(maxSteps);
        }
        for (const options of [
          { near: -1 },
          { near: 20, far: 20 },
          { far: Infinity },
          { tolerance: 0 },
          { tolerance: NaN },
          { maxSteps: 1 },
          { maxSteps: 2.5 },
        ])
          expect(() => query.raycast([0, 10, 0], [0, -1, 0], options)).toThrow(
            "Invalid terrain ray",
          );
        expect(() => query.raycast([NaN, 0, 0], [0, -1, 0])).toThrow();
        expect(() => query.raycast([0, 0, 0], [0, 0, 0])).toThrow();
        expect(() => query.raycast([0, 0, 0], [0, -2, 0])).toThrow();
        expect(query.raycast([0, 10, 0], [0, -1, 0], { near: 10, far: 20 })).toMatchObject({
          status: "hit",
          distance: 10,
        });
        expect(query.raycast([0, 10, 0], [0, -1, 0], { far: 10 })).toMatchObject({
          status: "hit",
          distance: 10,
        });
      }
    } finally {
      lease.release();
      await fixture.dispose();
    }
  });

  it("pins raycast revisions across edits and disposal without cross-instance leakage", async () => {
    const a = await createRaycastFixture("flat-down");
    const b = await createRaycastFixture("flat-down");
    const lease = a.runtime.query.acquireSnapshot()!;
    const cast = (q: typeof lease | typeof a.runtime.query) =>
      q.raycast([0, 10, 0], [0, -1, 0], { far: 20 });
    try {
      const original = cast(lease);
      a.runtime.configure({ offset: 5 });
      await a.runtime.update({ position: [0, 20, 0] });
      const latest = cast(a.runtime.query);
      expect(latest.status).toBe("hit");
      if (latest.status !== "hit") throw new Error("Required fresh hit");
      expect(latest.distance).toBeCloseTo(5, 3);
      expect(latest.sample.revision.editVersion).toBeGreaterThan(lease.revision.editVersion);
      expect(cast(lease)).toEqual(original);
      const other = cast(b.runtime.query);
      expect(other.status).toBe("hit");
      if (other.status !== "hit") throw new Error("Required peer hit");
      expect(other.distance).toBeCloseTo(10, 3);
      expect(other.sample.revision.instanceId).not.toBe(lease.revision.instanceId);
      await a.dispose();
      expect(cast(a.runtime.query)).toEqual({ status: "incomplete", reason: "not-ready" });
      expect(cast(lease)).toEqual(original);
      expect(a.disposedHeights).toEqual([5]);
      lease.release();
      lease.release();
      expect(a.disposedHeights).toEqual([5, 0]);
      expect(() => cast(lease)).toThrow("released");
      expect(a.runtime.getStatus().retainedSnapshotCount).toBe(0);
    } finally {
      lease.release();
      await a.dispose();
      await b.dispose();
    }
  });
});
