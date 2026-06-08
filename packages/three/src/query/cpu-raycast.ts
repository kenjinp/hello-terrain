import { Vector3 } from "three";
import type { Ray } from "three";
import type { SurfaceProjection } from "../quadtree";
import type {
  RaycastOptions,
  TerrainQuery,
  TerrainRaycastResult,
} from "./types";

export type CpuRaycastConfig = {
  rootSize: number;
  originX: number;
  originZ: number;
  minY: number;
  maxY: number;
  /** Surface projection; `cubeSphere` selects the radial sphere raycast. */
  projection?: SurfaceProjection;
  /** Planet center (cube-sphere only). */
  centerX?: number;
  centerY?: number;
  centerZ?: number;
  /** Base sphere radius (cube-sphere only). */
  radius?: number;
  /** Inner/outer radial bounds of the terrain shell (cube-sphere only). */
  minRadius?: number;
  maxRadius?: number;
};

type RaySegment = {
  tMin: number;
  tMax: number;
};

type TerrainBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
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

function getTerrainBounds(config: CpuRaycastConfig): TerrainBounds {
  const halfRoot = config.rootSize * 0.5;
  return {
    minX: config.originX - halfRoot,
    maxX: config.originX + halfRoot,
    minZ: config.originZ - halfRoot,
    maxZ: config.originZ + halfRoot,
  };
}

/**
 * Compute signed distance from a point to the terrain surface.
 * Returns positive when above, negative when below, undefined when
 * no valid tile covers the XZ position.
 *
 * When tile bounds are available, points that are clearly above the
 * tile's max elevation or below its min elevation return a conservative
 * signed distance without performing the expensive bilinear sample.
 */
function terrainSignedDistanceFromBounds(
  query: TerrainQuery,
  worldX: number,
  worldY: number,
  worldZ: number,
): number | undefined {
  const tileBounds = query.getTileBounds(worldX, worldZ);
  if (tileBounds) {
    if (worldY > tileBounds.maxElevation) {
      return worldY - tileBounds.maxElevation;
    }
    if (worldY < tileBounds.minElevation) {
      return worldY - tileBounds.minElevation;
    }
  }
  const elevation = query.getElevation(worldX, worldZ);
  if (!Number.isFinite(elevation)) return undefined;
  return worldY - (elevation as number);
}

/**
 * Full-precision signed distance using bilinear interpolation.
 * Used during binary refinement where we need exact elevation, not bounds.
 */
function terrainSignedDistancePrecise(
  query: TerrainQuery,
  worldX: number,
  worldY: number,
  worldZ: number,
): number | undefined {
  const elevation = query.getElevation(worldX, worldZ);
  if (!Number.isFinite(elevation)) return undefined;
  return worldY - (elevation as number);
}

export function cpuRaycast(
  query: TerrainQuery,
  ray: Ray,
  config: CpuRaycastConfig,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const bounds = getTerrainBounds(config);
  const segment = intersectRayAabb(
    ray,
    bounds.minX,
    config.minY,
    bounds.minZ,
    bounds.maxX,
    config.maxY,
    bounds.maxZ,
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
  let prevSignedDistance = terrainSignedDistanceFromBounds(
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
    const signedDistance = terrainSignedDistanceFromBounds(
      query,
      point.x,
      point.y,
      point.z,
    );
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
        const midDistance = terrainSignedDistancePrecise(
          query,
          point.x,
          point.y,
          point.z,
        );
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

export function cpuRaycastBoundsOnly(
  ray: Ray,
  config: CpuRaycastConfig,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const bounds = getTerrainBounds(config);
  const planeY = (config.minY + config.maxY) * 0.5;
  const dirY = ray.direction.y;
  if (Math.abs(dirY) < 1e-8) return null;
  const t = (planeY - ray.origin.y) / dirY;
  if (t < 0) return null;
  const maxDistance = options?.maxDistance ?? Number.POSITIVE_INFINITY;
  if (t > maxDistance) return null;
  const point = new Vector3();
  ray.at(t, point);
  if (
    point.x < bounds.minX ||
    point.x > bounds.maxX ||
    point.z < bounds.minZ ||
    point.z > bounds.maxZ
  ) {
    return null;
  }
  return {
    position: point,
    normal: new Vector3(0, 1, 0),
    distance: ray.origin.distanceTo(point),
  };
}

type SphereSegment = { t0: number; t1: number };

/** Intersect a ray with a sphere; returns near/far parametric distances. */
function intersectRaySphere(
  ray: Ray,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): SphereSegment | null {
  const ox = ray.origin.x - cx;
  const oy = ray.origin.y - cy;
  const oz = ray.origin.z - cz;
  const dx = ray.direction.x;
  const dy = ray.direction.y;
  const dz = ray.direction.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const inv2a = 1 / (2 * a);
  return { t0: (-b - sqrtDisc) * inv2a, t1: (-b + sqrtDisc) * inv2a };
}

/**
 * Radial signed distance from a world point to the displaced sphere surface:
 * positive above the terrain, negative below, undefined when no tile covers
 * the direction. `scratchDir` is reused to avoid per-sample allocation.
 */
function sphereSignedDistance(
  query: TerrainQuery,
  config: CpuRaycastConfig,
  px: number,
  py: number,
  pz: number,
  scratchDir: Vector3,
): number | undefined {
  const cx = config.centerX ?? 0;
  const cy = config.centerY ?? 0;
  const cz = config.centerZ ?? 0;
  const radius = config.radius ?? 0;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const dist = Math.hypot(dx, dy, dz);
  scratchDir.set(dx, dy, dz);
  const elevation = query.getElevationByDirection(scratchDir);
  if (elevation === null) return undefined;
  return dist - (radius + elevation);
}

export function cubeSphereRaycast(
  query: TerrainQuery,
  ray: Ray,
  config: CpuRaycastConfig,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const cx = config.centerX ?? 0;
  const cy = config.centerY ?? 0;
  const cz = config.centerZ ?? 0;
  const radius = config.radius ?? 0;
  const outerRadius = config.maxRadius ?? radius;

  const shell = intersectRaySphere(ray, cx, cy, cz, outerRadius);
  if (!shell) return null;

  const maxDistance = options?.maxDistance ?? Number.POSITIVE_INFINITY;
  const startT = Math.max(0, shell.t0);
  const endT = Math.min(shell.t1, maxDistance);
  if (endT < startT) return null;

  const maxSteps = Math.max(8, options?.maxSteps ?? 256);
  const refinementSteps = Math.max(1, options?.refinementSteps ?? 12);

  const scratchDir = new Vector3();
  const point = new Vector3();
  let prevT = startT;
  ray.at(prevT, point);
  let prevSd = sphereSignedDistance(query, config, point.x, point.y, point.z, scratchDir);

  const finalize = (hitT: number): TerrainRaycastResult | null => {
    ray.at(hitT, point);
    const sample = query.sampleTerrainByPosition(point);
    if (!sample.valid) return null;
    return {
      position: sample.position.clone(),
      normal: sample.normal.clone(),
      distance: ray.origin.distanceTo(sample.position),
    };
  };

  if (prevSd !== undefined && prevSd <= 0) {
    return finalize(prevT);
  }

  for (let i = 1; i <= maxSteps; i += 1) {
    const t = startT + ((endT - startT) * i) / maxSteps;
    ray.at(t, point);
    const sd = sphereSignedDistance(query, config, point.x, point.y, point.z, scratchDir);
    if (sd === undefined) {
      prevSd = undefined;
      prevT = t;
      continue;
    }
    if (prevSd !== undefined && prevSd > 0 && sd <= 0) {
      let lo = prevT;
      let hi = t;
      for (let r = 0; r < refinementSteps; r += 1) {
        const mid = (lo + hi) * 0.5;
        ray.at(mid, point);
        const midSd = sphereSignedDistance(query, config, point.x, point.y, point.z, scratchDir);
        if (midSd === undefined) {
          lo = mid;
          continue;
        }
        if (midSd > 0) lo = mid;
        else hi = mid;
      }
      return finalize(hi);
    }
    prevSd = sd;
    prevT = t;
  }

  return null;
}

/** Coarse fallback: intersect the base sphere and return a radial-normal hit. */
export function cubeSphereRaycastBoundsOnly(
  ray: Ray,
  config: CpuRaycastConfig,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const cx = config.centerX ?? 0;
  const cy = config.centerY ?? 0;
  const cz = config.centerZ ?? 0;
  const radius = config.radius ?? 0;
  const shell = intersectRaySphere(ray, cx, cy, cz, radius);
  if (!shell) return null;
  const maxDistance = options?.maxDistance ?? Number.POSITIVE_INFINITY;
  const t = shell.t0 >= 0 ? shell.t0 : shell.t1;
  if (t < 0 || t > maxDistance) return null;
  const point = new Vector3();
  ray.at(t, point);
  const normal = new Vector3(point.x - cx, point.y - cy, point.z - cz).normalize();
  return { position: point, normal, distance: ray.origin.distanceTo(point) };
}
