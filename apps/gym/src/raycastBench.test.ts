import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const cwd = fileURLToPath(new URL("../", import.meta.url));
function run(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "raycast-bench.ts", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

it("reports validated live and pinned batches without conflating batch and ray percentiles", () => {
  const result = run(
    "--scenario",
    "flat-down",
    "--seed",
    "0",
    "--count",
    "7",
    "--batch-size",
    "3",
    "--repeat",
    "2",
    "--warmup",
    "0",
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.valid).toBe(true);
  expect(report.correctness.failures).toEqual([]);
  expect(report.correctness.validatedRays).toBe(42);
  expect(report.results.map((row: { mode: string }) => row.mode)).toEqual(["live", "pinned"]);
  for (const row of report.results)
    for (const repeat of row.repeats) {
      expect(repeat.valid).toBe(true);
      expect(repeat.outcomes.hit).toBe(7);
      expect(repeat.completionRate).toBe(1);
      expect(repeat.batches.map((batch: { rays: number }) => batch.rays)).toEqual([3, 3, 1]);
      expect(repeat.timing.batchRays).toBe(3);
      expect(repeat.timing.batchP95Ms).toBe(
        Math.max(repeat.batches[0].milliseconds, repeat.batches[1].milliseconds),
      );
      expect(repeat.timing.raysPerSecond).toBeGreaterThan(0);
      expect(repeat.maxSurfaceError).toBeLessThanOrEqual(0.0001 + 2e-8);
      expect(repeat.sampleCalls).toBeLessThanOrEqual(7 * 256);
    }
  expect(report.source.hashes["pnpm-lock.yaml"]).toMatch(/^[a-f0-9]{64}$/);
}, 30000);

it("preserves incomplete quality beside throughput rather than reporting misses", () => {
  const result = run(
    "--scenario",
    "late-bracket",
    "--count",
    "2",
    "--repeat",
    "1",
    "--warmup",
    "0",
  );
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  for (const row of report.results) {
    const repeat = row.repeats[0];
    expect(repeat.knownIntersections).toBe(2);
    expect(repeat.outcomes.hit + repeat.outcomes["work-budget"]).toBe(2);
    expect(repeat.completionRate).toBe(repeat.outcomes.hit / 2);
    expect(repeat.outcomes.miss).toBeUndefined();
  }
}, 30000);

it.each([
  ["--count", "0"],
  ["--repeat", "NaN"],
  ["--seed", "-1"],
  ["--scenario", "unknown"],
  ["--bogus", "1"],
  ["--count"],
])(
  "rejects invalid CLI arguments %s %s",
  (...args) => {
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  },
  30000,
);
