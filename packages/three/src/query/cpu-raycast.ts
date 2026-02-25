import { Vector3 } from "three";
import type { Ray } from "three";
import type { RaycastOptions, TerrainQuery, TerrainRaycastResult } from "./types";

export type CpuRaycastConfig = {
  rootSize: number;
  originX: number;
  originZ: number;
  minY: number;
  maxY: number;
};

type RaySegment = {
  tMin: number;
  tMax: number;
};

function intersectRayAabb(
  ray: Ray,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): RaySegment | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const origin = ray.origin;
  const dir = ray.direction;

  const slab = (
    originAxis: number,
    dirAxis: number,
    minAxis: number,
    maxAxis: number,
  ) => {
    if (Math.abs(dirAxis) < 1e-8) {
      if (originAxis < minAxis || originAxis > maxAxis) return false;
      return true;
    }
    const inv = 1 / dirAxis;
    let t0 = (minAxis - originAxis) * inv;
    let t1 = (maxAxis - originAxis) * inv;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    return tMax >= tMin;
  };

  if (
    !slab(origin.x, dir.x, minX, maxX) ||
    !slab(origin.y, dir.y, minY, maxY) ||
    !slab(origin.z, dir.z, minZ, maxZ)
  ) {
    return null;
  }
  return { tMin, tMax };
}

function terrainSignedDistance(
  query: TerrainQuery,
  worldX: number,
  worldY: number,
  worldZ: number,
): number | undefined {
  const sample = query.sampleTerrain(worldX, worldZ);
  if (!sample.valid) return undefined;
  return worldY - sample.elevation;
}

export function cpuRaycast(
  query: TerrainQuery,
  ray: Ray,
  config: CpuRaycastConfig,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const halfRoot = config.rootSize * 0.5;
  const minX = config.originX - halfRoot;
  const maxX = config.originX + halfRoot;
  const minZ = config.originZ - halfRoot;
  const maxZ = config.originZ + halfRoot;
  const segment = intersectRayAabb(
    ray,
    minX,
    config.minY,
    minZ,
    maxX,
    config.maxY,
    maxZ,
  );
  if (!segment) return null;

  const maxDistance = options?.maxDistance ?? Number.POSITIVE_INFINITY;
  let startT = Math.max(0, segment.tMin);
  const endT = Math.min(segment.tMax, maxDistance);
  if (endT < startT) return null;

  const maxSteps = Math.max(8, options?.maxSteps ?? 128);
  const refinementSteps = Math.max(1, options?.refinementSteps ?? 8);

  const point = new Vector3();
  let prevT = startT;
  ray.at(prevT, point);
  let prevSignedDistance = terrainSignedDistance(
    query,
    point.x,
    point.y,
    point.z,
  );

  if (prevSignedDistance !== undefined && prevSignedDistance <= 0) {
    const sample = query.sampleTerrain(point.x, point.z);
    if (!sample.valid) return null;
    point.y = sample.elevation;
    return {
      position: point.clone(),
      normal: sample.normal.clone(),
      distance: ray.origin.distanceTo(point),
    };
  }

  for (let i = 1; i <= maxSteps; i += 1) {
    const t = startT + ((endT - startT) * i) / maxSteps;
    ray.at(t, point);
    const signedDistance = terrainSignedDistance(query, point.x, point.y, point.z);
    if (signedDistance === undefined) {
      prevSignedDistance = undefined;
      prevT = t;
      continue;
    }

    if (
      prevSignedDistance !== undefined &&
      prevSignedDistance > 0 &&
      signedDistance <= 0
    ) {
      let lo = prevT;
      let hi = t;
      for (let r = 0; r < refinementSteps; r += 1) {
        const mid = (lo + hi) * 0.5;
        ray.at(mid, point);
        const midDistance = terrainSignedDistance(query, point.x, point.y, point.z);
        if (midDistance === undefined) {
          lo = mid;
          continue;
        }
        if (midDistance > 0) lo = mid;
        else hi = mid;
      }
      const hitT = hi;
      ray.at(hitT, point);
      const sample = query.sampleTerrain(point.x, point.z);
      if (!sample.valid) return null;
      point.y = sample.elevation;
      return {
        position: point.clone(),
        normal: sample.normal.clone(),
        distance: ray.origin.distanceTo(point),
      };
    }

    prevSignedDistance = signedDistance;
    prevT = t;
  }

  return null;
}
