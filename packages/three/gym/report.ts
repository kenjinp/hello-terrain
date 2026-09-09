import type { Assertion } from "./oracles";
import type { GymMode } from "./scenarios";

export type GymResult = {
  status: "passed" | "failed" | "unsupported" | "error";
  assertions: Assertion[];
  metrics: Record<string, number | null>;
  samples: unknown[];
  capabilities?: Record<string, unknown>;
  error?: string;
  images?: { name: string; dataUrl: string }[];
};
export type GymReport = {
  schemaVersion: 1;
  mode: GymMode;
  scenario: string;
  seed: number;
  fingerprint: Record<string, unknown>;
  source: { commit: string; treeHash: string };
  result: GymResult;
  repro: string;
};

export function summarize(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  // Nearest-rank quantiles; retain every stall and leave unavailable data null.
  const quantile = (p: number) =>
    sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  return { count: sorted.length, median: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99) };
}

export function exitCode(status: GymResult["status"]): number {
  return status === "passed" ? 0 : status === "failed" ? 1 : 2;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function compareReports(baseline: GymReport, candidate: GymReport) {
  if (
    baseline.schemaVersion !== 1 ||
    candidate.schemaVersion !== 1 ||
    baseline.mode !== candidate.mode ||
    baseline.scenario !== candidate.scenario ||
    baseline.seed !== candidate.seed ||
    canonical(baseline.fingerprint) !== canonical(candidate.fingerprint)
  ) {
    return {
      comparable: false,
      reason: "Scenario, environment, mode or measurement settings differ",
      deltas: {},
    };
  }
  if (baseline.result.status !== "passed" || candidate.result.status !== "passed") {
    return { comparable: false, reason: "Both runs must pass correctness", deltas: {} };
  }
  if (candidate.mode === "perf" && candidate.result.capabilities?.hardware !== true) {
    return { comparable: false, reason: "Hardware GPU identity is not established", deltas: {} };
  }
  const deltas = Object.fromEntries(
    Object.entries(candidate.result.metrics).flatMap(([key, value]) => {
      const before = baseline.result.metrics[key];
      return typeof before === "number" &&
        typeof value === "number" &&
        Number.isFinite(before) &&
        Number.isFinite(value)
        ? [
            [
              key,
              {
                baseline: before,
                candidate: value,
                delta: value - before,
                percent: before ? ((value - before) / before) * 100 : null,
              },
            ],
          ]
        : [];
    }),
  );
  return {
    comparable: true,
    reason: "Matched environment; inspect quality and timing together",
    deltas,
  };
}
