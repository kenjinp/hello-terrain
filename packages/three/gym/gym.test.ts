import { describe, expect, it } from "vitest";
import {
  analyticElevation,
  analyticNormal,
  elevationTolerance,
  flatPartitionAssertions,
  numericAssertion,
  surfaceProbes,
  surfaceReference,
} from "./oracles";
import { compareReports, exitCode, summarize, type GymReport } from "./report";
import { getScenario, probePoints } from "./scenarios";
import { runCpu } from "./cpu";

describe("gym detects defects instead of blessing output", () => {
  it("rejects holes, overlaps and unbalanced adjacent leaves independently", () => {
    const root = { space: 0, level: 0, x: 0, y: 0 };
    expect(flatPartitionAssertions([root], 10, "root").every((a) => a.pass)).toBe(true);
    expect(flatPartitionAssertions([], 10, "hole").find((a) => a.name === "partition")?.pass).toBe(
      false,
    );
    expect(
      flatPartitionAssertions([root, root], 10, "overlap").find((a) => a.name === "partition")
        ?.pass,
    ).toBe(false);
    expect(
      flatPartitionAssertions(
        [
          { space: 0, level: 1, x: 0, y: 0 },
          { space: 0, level: 4, x: 8, y: 0 },
        ],
        10,
        "unbalanced",
      ).find((a) => a.name === "balance-2to1")?.pass,
    ).toBe(false);
  });

  it("rejects stale fields, missing samples, NaN and inverted normals", () => {
    const scenario = getScenario("flat-edit");
    const expected = analyticElevation(scenario.edited, 0, 0);
    const tolerance = elevationTolerance(scenario.edited, scenario.rootSize, true);
    for (const actual of [scenario.initial.offset, null, NaN, Infinity]) {
      expect(numericAssertion("edit", "elevation", actual, expected, tolerance).pass).toBe(false);
    }
    const normal = analyticNormal(scenario.initial);
    expect(numericAssertion("normal", "y", -normal[1], normal[1], 0.01).pass).toBe(false);
    expect(Math.hypot(...normal)).toBeCloseTo(1, 12);
    expect(tolerance).toBeLessThan(Math.abs(scenario.edited.offset - scenario.initial.offset));
  });

  it("replays seeded probes and exercises the real CPU quadtree", () => {
    expect(probePoints(7)).toEqual(probePoints(7));
    expect(probePoints(8)).not.toEqual(probePoints(7));
    const result = runCpu(getScenario("flat-lod"));
    expect(result.status).toBe("passed");
    expect(result.assertions).toHaveLength(64);
  });

  it.each(["sphere-seams", "torus-wrap"])(
    "checks %s against independent implicit surfaces",
    (id) => {
      const scenario = getScenario(id);
      for (const point of surfaceProbes(scenario)) {
        const reference = surfaceReference(scenario, point);
        expect(reference.elevation).toBeCloseTo(0, 10);
        expect(Math.hypot(...reference.normal)).toBeCloseTo(1, 10);
        const displaced = point.map((v, i) => v + 7 * reference.normal[i]);
        expect(surfaceReference(scenario, displaced).elevation).toBeCloseTo(7, 10);
      }
      expect(runCpu(scenario).status).toBe("passed");
    },
  );
});

function report(): GymReport {
  return {
    schemaVersion: 1,
    mode: "perf",
    scenario: "flat-edit",
    seed: 7,
    fingerprint: { adapter: "gpu-a", scenarioHash: "v1", resolution: 640 },
    source: { commit: "abc", treeHash: "original" },
    repro: "pnpm gym",
    result: {
      status: "passed",
      assertions: [],
      samples: [],
      metrics: { frameP95Ms: 20 },
      capabilities: { hardware: true },
    },
  };
}

describe("report verdicts and comparison", () => {
  it("separates failed validation from unavailable execution", () => {
    expect(exitCode("passed")).toBe(0);
    expect(exitCode("failed")).toBe(1);
    expect(exitCode("unsupported")).toBe(2);
    expect(exitCode("error")).toBe(2);
  });
  it("compares changed source with unchanged environment", () => {
    const before = report(),
      after = report();
    after.source.treeHash = "candidate";
    after.result.metrics.frameP95Ms = 10;
    const comparison = compareReports(before, after);
    expect(comparison.comparable).toBe(true);
    expect(comparison.deltas.frameP95Ms?.percent).toBe(-50);
  });
  it("refuses environment drift, weakened scenarios, invalid output and software perf", () => {
    for (const key of ["adapter", "scenarioHash", "resolution"]) {
      const after = report();
      after.fingerprint[key] = "different";
      expect(compareReports(report(), after).comparable).toBe(false);
    }
    const after = report();
    after.result.status = "failed";
    expect(compareReports(report(), after).comparable).toBe(false);
    after.result.status = "passed";
    after.result.capabilities!.hardware = false;
    expect(compareReports(report(), after).comparable).toBe(false);
  });
  it("retains tail stalls in the distribution", () => {
    expect(summarize([...Array(18).fill(10), 200, 1000]).p95).toBe(200);
    expect(summarize([...Array(18).fill(10), 200, 1000]).p99).toBe(1000);
    expect(summarize([]).median).toBe(null);
  });
});
