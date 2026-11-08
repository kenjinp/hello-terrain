import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  createRaycastCases,
  createRaycastFixture,
  validateRaycastResult,
  raycastScenarioIds,
  raycastScenarioDescriptions,
  raycastSurfaceError,
} from "../../packages/three/gym/raycast";
import type { TerrainRaycastSample } from "../../packages/three/src/runtime/runtime";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function integer(value: string, name: string, min: number, max: number) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${name}: expected ${min}..${max}`);
  return n;
}
function argumentsForRun(args: string[]) {
  const config = {
    seed: 7,
    count: 1000,
    batchSize: 100,
    repeat: 5,
    warmup: 200,
    scenario: "all",
    output: "",
  };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--help") {
      console.log(
        "pnpm bench:raycast [--seed 7] [--count 1000] [--batch-size 100] [--repeat 5] [--warmup 200] [--scenario all|ID] [--output report.json]\nScenarios: " +
          raycastScenarioIds.join(", "),
      );
      process.exit(0);
    }
    const value = args[++i];
    if (value === undefined) throw new Error(`Missing value for ${key}`);
    switch (key) {
      case "--seed":
        config.seed = integer(value, key, 0, 0xffffffff);
        break;
      case "--count":
        config.count = integer(value, key, 1, 1_000_000);
        break;
      case "--batch-size":
        config.batchSize = integer(value, key, 1, 100_000);
        break;
      case "--repeat":
        config.repeat = integer(value, key, 1, 100);
        break;
      case "--warmup":
        config.warmup = integer(value, key, 0, 1_000_000);
        break;
      case "--scenario":
        config.scenario = value;
        break;
      case "--output":
        config.output = resolve(value);
        break;
      default:
        throw new Error(`Unknown option ${key}`);
    }
  }
  if (config.scenario !== "all" && !raycastScenarioIds.some((id) => id === config.scenario))
    throw new Error(`Unknown scenario ${config.scenario}`);
  return config;
}
function fingerprint() {
  const files = [
    "apps/gym/raycast-bench.ts",
    "packages/three/gym/raycast.ts",
    "packages/three/src/runtime/runtime.ts",
    "pnpm-lock.yaml",
  ];
  return Object.fromEntries(
    files.map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(resolve(root, file)))
        .digest("hex"),
    ]),
  );
}
function git(...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}
async function main() {
  const config = argumentsForRun(process.argv.slice(2));
  const before = fingerprint();
  const scenarios = raycastScenarioIds.filter(
    (id) => config.scenario === "all" || id === config.scenario,
  );
  const report = {
    schemaVersion: 1,
    valid: true,
    scope:
      "CPU public raycast over analytic snapshot backends; not GPU, tile cache, LOD, rendered triangles, or frame performance.",
    timestamp: new Date().toISOString(),
    config,
    environment: {
      node: process.version,
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
    },
    source: {
      commit: git("rev-parse", "HEAD"),
      dirty: git("status", "--porcelain") !== "",
      hashes: before,
    },
    timingContract:
      "Batch wall-clock times include synchronous raycast and result-array storage. Validation, fixture setup and report collection are outside timers. Percentiles describe batches, not individual rays. Unequal final batches are excluded from batch percentiles but included in totals.",
    correctness: { failures: [] as string[], validatedRays: 0 },
    results: [] as {
      scenario: string;
      description: string;
      mode: string;
      repeats: { valid: boolean; timing: unknown }[];
    }[],
  };
  for (const scenario of scenarios) {
    const rays = createRaycastCases(scenario, config.seed, config.count);
    for (const mode of ["live", "pinned"] as const) {
      const fixture = await createRaycastFixture(scenario);
      const lease = mode === "pinned" ? fixture.runtime.query.acquireSnapshot()! : null;
      const revision = lease?.revision ?? fixture.runtime.getStatus().queryRevision!;
      const cast = (ray: (typeof rays)[number]) =>
        lease
          ? lease.raycast(ray.origin, ray.direction, ray.options)
          : fixture.runtime.query.raycast(ray.origin, ray.direction, ray.options);
      let preflightFailed = false;
      const check = (ray: (typeof rays)[number], result: TerrainRaycastSample) => {
        report.correctness.validatedRays++;
        const failures = validateRaycastResult(ray, result, revision);
        for (const failure of failures) {
          if (report.correctness.failures.length < 100)
            report.correctness.failures.push(`${scenario}/${mode}/${ray.id}: ${failure}`);
        }
        return failures.length === 0;
      };
      try {
        for (const ray of rays) if (!check(ray, cast(ray))) preflightFailed = true;
        if (preflightFailed) continue; // Never publish timing for an invalid fixture.
        for (let i = 0; i < config.warmup; i++) cast(rays[i % rays.length]!);
        const repeats = [];
        for (let repeat = 0; repeat < config.repeat; repeat++) {
          const batches: { rays: number; milliseconds: number }[] = [];
          const outcomes: Record<string, number> = {
            hit: 0,
            "not-ready": 0,
            "outside-coverage": 0,
            "work-budget": 0,
          };
          let knownIntersections = 0,
            completedKnownIntersections = 0,
            maxDistanceError = 0,
            maxSurfaceError = 0;
          let valid = true;
          fixture.resetSampleCount();
          for (let offset = 0; offset < rays.length; offset += config.batchSize) {
            const end = Math.min(offset + config.batchSize, rays.length);
            const results: TerrainRaycastSample[] = [];
            results.length = end - offset;
            const start = performance.now();
            for (let i = offset; i < end; i++) results[i - offset] = cast(rays[i]!);
            const milliseconds = performance.now() - start;
            batches.push({ rays: end - offset, milliseconds });
            for (let i = offset; i < end; i++) {
              const ray = rays[i]!,
                result = results[i - offset]!;
              if (!check(ray, result)) valid = false;
              outcomes[result.status === "hit" ? "hit" : result.reason]++;
              if (result.status === "hit")
                maxSurfaceError = Math.max(
                  maxSurfaceError,
                  raycastSurfaceError(scenario, result.sample.position),
                );
              if (ray.expectedDistance !== null) {
                knownIntersections++;
                if (result.status === "hit") {
                  completedKnownIntersections++;
                  maxDistanceError = Math.max(
                    maxDistanceError,
                    Math.abs(result.distance - ray.expectedDistance),
                  );
                }
              }
            }
          }
          const totalMs = batches.reduce((sum, batch) => sum + batch.milliseconds, 0);
          const fullBatches = batches
            .filter((b) => b.rays === Math.min(config.batchSize, config.count))
            .map((b) => b.milliseconds);
          repeats.push({
            repeat,
            valid,
            outcomes,
            knownIntersections,
            completedKnownIntersections,
            completionRate: knownIntersections
              ? completedKnownIntersections / knownIntersections
              : null,
            maxDistanceError: completedKnownIntersections ? maxDistanceError : null,
            maxSurfaceError: outcomes.hit ? maxSurfaceError : null,
            sampleCalls: fixture.sampleCount(),
            batches,
            timing: valid
              ? {
                  totalMs,
                  raysPerSecond: (rays.length / totalMs) * 1000,
                  batchRays: Math.min(config.batchSize, config.count),
                  batchP50Ms: percentile(fullBatches, 0.5),
                  batchP95Ms: percentile(fullBatches, 0.95),
                  batchP99Ms: percentile(fullBatches, 0.99),
                }
              : null,
          });
        }
        report.results.push({
          scenario,
          description: raycastScenarioDescriptions[scenario],
          mode,
          repeats,
        });
        const first = repeats[0]!;
        console.error(
          `${scenario} ${mode}: ${first.outcomes.hit}/${rays.length} hits; known-hit completion ${first.completionRate === null ? "n/a" : (100 * first.completionRate).toFixed(1) + "%"}; first-repeat ${first.timing?.raysPerSecond.toFixed(0) ?? "INVALID"} rays/s`,
        );
      } finally {
        lease?.release();
        await fixture.dispose();
      }
    }
  }
  if (JSON.stringify(before) !== JSON.stringify(fingerprint())) {
    report.correctness.failures.push("Sources changed during the run; timings invalid.");
    for (const row of report.results)
      for (const repeat of row.repeats) {
        repeat.valid = false;
        repeat.timing = null;
      }
  }
  report.valid = report.correctness.failures.length === 0;
  const output = JSON.stringify(report, null, 2) + "\n";
  if (config.output) {
    mkdirSync(dirname(config.output), { recursive: true });
    writeFileSync(config.output, output);
    console.error(`Report: ${config.output}`);
  } else console.log(output);
  if (report.correctness.failures.length) {
    console.error(report.correctness.failures.join("\n"));
    process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
