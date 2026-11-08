import type { Vec3 } from "math";
import {
  createTerrainRuntime,
  type TerrainRaycastOptions,
  type TerrainRaycastSample,
  type TerrainRevision,
} from "../src/runtime/runtime";

export const raycastScenarioIds = [
  "flat-down",
  "flat-oblique",
  "earth-plane",
  "sphere",
  "grazing",
  "thin-ridge",
  "late-bracket",
  "coverage-hole",
  "flat-away",
] as const;
export type RaycastScenarioId = (typeof raycastScenarioIds)[number];
export const raycastScenarioDescriptions: Record<RaycastScenarioId, string> = {
  "flat-down": "Seeded downward rays against a horizontal plane",
  "flat-oblique": "Seeded oblique rays against an inclined plane",
  "earth-plane":
    "Submeter heights on a plane translated to Earth-scale coordinates; not planetary LOD coverage",
  sphere: "Seeded radial rays against an analytic sphere",
  grazing: "Exact tangencies to an analytic sphere; incomplete is permitted",
  "thin-ridge": "A one-unit triangular ridge inside a 10000-unit range; incomplete is permitted",
  "late-bracket": "Plane crossing in the final scan interval; incomplete is permitted",
  "coverage-hole": "Unavailable initial samples; must report outside-coverage",
  "flat-away": "Rays directed away from the plane; incomplete is not an authoritative miss",
};
export interface RaycastCase {
  id: string;
  scenario: RaycastScenarioId;
  origin: Vec3;
  direction: Vec3;
  options: TerrainRaycastOptions;
  expectedDistance: number | null;
  requiredHit: boolean;
}
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function planeHeight(s: RaycastScenarioId, x: number, z: number) {
  return s === "earth-plane" ? 6371000.125 : s === "flat-oblique" ? 0.2 * x - 0.1 * z : 0;
}
function ridgeHeight(x: number) {
  return Math.max(0, 1 - Math.abs(x - 20) * 2);
}
function normalAt(s: RaycastScenarioId, p: Vec3): Vec3 {
  if (s === "sphere" || s === "grazing") return unit(p);
  if (s === "flat-oblique") return unit([-0.2, 1, 0.1]);
  if (s === "thin-ridge" && Math.abs(p[0] - 20) < 0.5) return unit([p[0] < 20 ? -2 : 2, 1, 0]);
  return [0, 1, 0];
}
/** Independent implicit residual, not a comparison with another raycast. */
export function raycastSurfaceError(s: RaycastScenarioId, p: Vec3): number {
  if (s === "sphere" || s === "grazing") return Math.abs(Math.hypot(...p) - 10);
  if (s === "thin-ridge") return Math.abs(p[1] - ridgeHeight(p[0]));
  return Math.abs(p[1] - planeHeight(s, p[0], p[2]));
}
export function createRaycastCases(
  scenario: RaycastScenarioId,
  seed: number,
  count: number,
): RaycastCase[] {
  if (!raycastScenarioIds.includes(scenario)) throw new Error("Unknown raycast scenario");
  if (
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isSafeInteger(count) ||
    count < 1
  )
    throw new Error("Expected uint32 seed and positive integer count");
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const x = random() * 100 - 50,
      z = random() * 100 - 50,
      height = 1 + random() * 20;
    let origin: Vec3 = [x, height, z],
      direction: Vec3 = [0, -1, 0];
    let expectedDistance: number | null = height,
      far = 100,
      requiredHit = true;
    if (scenario === "flat-oblique") {
      origin = [x, planeHeight(scenario, x, z) + height, z];
      direction = unit([random() - 0.5, -1, random() - 0.5]);
      expectedDistance = -height / (direction[1] - 0.2 * direction[0] + 0.1 * direction[2]);
    } else if (scenario === "earth-plane") {
      origin = [6371000 + x, 6371000.125 + height, -6371000 + z];
      expectedDistance = origin[1] - 6371000.125;
    } else if (scenario === "sphere") {
      const radial = unit([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]);
      origin = radial.map((v) => v * (10 + height)) as Vec3;
      direction = radial.map((v) => -v) as Vec3;
      // First positive root of |origin + t * direction|^2 = 100.
      const b = dot(origin, direction),
        c = dot(origin, origin) - 100;
      expectedDistance = -b - Math.sqrt(b * b - c);
      far = height + 5;
    } else if (scenario === "grazing") {
      origin = [-20 - random(), 10, 0];
      direction = [1, 0, 0];
      expectedDistance = -origin[0];
      far = 50;
      requiredHit = false;
    } else if (scenario === "thin-ridge") {
      origin = [0, 0.5, z];
      direction = [1, 0, 0];
      expectedDistance = 19.75;
      far = 10000;
      requiredHit = false;
    } else if (scenario === "late-bracket") {
      origin = [x, 99.9, z];
      expectedDistance = 99.9;
      requiredHit = false;
    } else if (scenario === "coverage-hole") {
      expectedDistance = null;
      requiredHit = false;
    } else if (scenario === "flat-away") {
      direction = [0, 1, 0];
      expectedDistance = null;
      requiredHit = false;
    }
    return {
      id: scenario + ":" + seed + ":" + i,
      scenario,
      origin,
      direction,
      options: { near: 0, far, tolerance: 0.0001, maxSteps: 256 },
      expectedDistance,
      requiredHit,
    };
  });
}
/** Analytic snapshot backend; real public runtime/lease raycast, no GPU or terrain-cache claims. */
export async function createRaycastFixture(scenario: RaycastScenarioId) {
  if (!raycastScenarioIds.includes(scenario)) throw new Error("Unknown raycast scenario");
  let calls = 0;
  const disposedHeights: number[] = [];
  const runtime = createTerrainRuntime(
    {
      resolve: (c: { offset: number }) => ({ ...c }),
      equal: (a, b) => a.offset === b.offset,
      async produce(config) {
        const offset = config.offset;
        return {
          render: offset,
          retire: async () => {},
          snapshot: async () => ({
            sample(p: Vec3, revision: TerrainRevision) {
              calls++;
              if (scenario === "coverage-hole")
                return {
                  status: "unavailable" as const,
                  reason: "outside-coverage" as const,
                  revision,
                };
              const normal = normalAt(scenario, p);
              let position: Vec3;
              if (scenario === "sphere" || scenario === "grazing") {
                if (Math.hypot(...p) === 0)
                  return {
                    status: "unavailable" as const,
                    reason: "ambiguous-projection" as const,
                    revision,
                  };
                position = normal.map((v) => v * (10 + offset)) as Vec3;
              } else {
                position = [
                  p[0],
                  (scenario === "thin-ridge"
                    ? ridgeHeight(p[0])
                    : planeHeight(scenario, p[0], p[2])) + offset,
                  p[2],
                ];
              }
              return {
                status: "available" as const,
                revision,
                position,
                normal,
                elevation: offset,
                sampleSpacing: 1,
                tile: { space: 0, level: 0, x: 0, y: 0 },
              };
            },
            dispose() {
              disposedHeights.push(offset);
            },
          }),
        };
      },
      dispose: async () => {},
    },
    { offset: 0 },
    { readback: "on-change", maxRetainedSnapshots: 3 },
  );
  await runtime.update({ position: [0, 20, 0] });
  return {
    runtime,
    sampleCount: () => calls,
    resetSampleCount: () => {
      calls = 0;
    },
    disposedHeights,
    dispose: () => runtime.dispose(),
  };
}
/** Returns failures; diagnostic incompletes remain visible to the caller rather than passing as misses. */
export function validateRaycastResult(
  ray: RaycastCase,
  result: TerrainRaycastSample,
  revision?: TerrainRevision,
): string[] {
  const errors: string[] = [];
  if (result.status !== "hit") {
    if (ray.requiredHit) errors.push("required analytic intersection returned " + result.reason);
    if (ray.scenario === "coverage-hole" && result.reason !== "outside-coverage")
      errors.push("coverage reason");
    if (ray.scenario !== "coverage-hole" && result.reason !== "work-budget")
      errors.push("unexpected incomplete reason");
    return errors;
  }
  if (ray.expectedDistance === null) errors.push("unexpected hit");
  const t = result.distance,
    tolerance = ray.options.tolerance ?? 0.001;
  if (!Number.isFinite(t) || t < (ray.options.near ?? 0) || t > (ray.options.far ?? 10000))
    errors.push("distance range");
  const p = result.sample.position,
    n = result.sample.normal;
  if (![...p, ...n].every(Number.isFinite)) errors.push("nonfinite sample");
  const onRay = ray.origin.map((v, i) => v + t * ray.direction[i]!) as Vec3;
  if (gap(onRay, p) > 1e-7) errors.push("position off ray");
  const residual = raycastSurfaceError(ray.scenario, p);
  if (!Number.isFinite(residual) || residual > tolerance + 2e-8) errors.push("surface residual");
  const normal = normalAt(ray.scenario, p);
  if (Math.abs(Math.hypot(...n) - 1) > 1e-6 || gap(n, normal) > 1e-5) errors.push("normal");
  if (ray.expectedDistance !== null) {
    // Tangency's positional uncertainty is sqrt(2*r*tolerance), not tolerance.
    const allowance =
      ray.scenario === "grazing"
        ? Math.sqrt(20 * tolerance + tolerance * tolerance)
        : tolerance / Math.max(1e-8, Math.abs(dot(ray.direction, normal))) + 2e-7;
    if (Math.abs(t - ray.expectedDistance) > allowance)
      errors.push("nearest intersection distance");
  }
  if (
    revision &&
    Object.keys(revision).some(
      (key) =>
        result.sample.revision[key as keyof TerrainRevision] !==
        revision[key as keyof TerrainRevision],
    )
  )
    errors.push("snapshot revision");
  return errors;
}
