import { Vector3 } from "three";
import type { Ray } from "three";
import { positionToTorusParams, type TorusSurfaceParams } from "../quadtree/topology/torusInverse";
import type {
  RaycastOptions,
  TerrainQuery,
  TerrainRaycastConfig,
  TerrainRaycastResult,
  TerrainSphereQuery,
  TerrainSurfaceQuery,
} from "./types";

export type { TerrainRaycastConfig };

/** Curved-shell parameters supplied by the cube-sphere projection. */
export type SphereRaycastParams = {
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
  /** Outer shell radius (base radius + max displacement). */
  maxRadius: number;
  /** When true, elevation displaces inward and signed distance is flipped. */
  invert?: boolean;
};

/** Curved-shell parameters supplied by the torus projection. */
export type TorusRaycastParams = {
  centerX: number;
  centerY: number;
  centerZ: number;
  majorRadius: number;
  minorRadius: number;
  /** Outer bounding-sphere radius (major + minor + max displacement). */
  outerRadius: number;
  /** When true, elevation displaces inward and signed distance is flipped. */
  invert?: boolean;
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

  const slab = (originAxis: number, dirAxis: number, minAxis: number, maxAxis: number) => {
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

function getTerrainBounds(config: TerrainRaycastConfig): TerrainBounds {
  const halfRoot = config.rootSize * 0.5;
  return {
    minX: config.originX - halfRoot,
    maxX: config.originX + halfRoot,
    minZ: config.originZ - halfRoot,
    maxZ: config.originZ + halfRoot,
  };
}

function terrainSignedDistance(
  query: TerrainQuery,
  worldX: number,
  worldY: number,
  worldZ: number,
  skipBoundsFastPath: boolean,
): number | undefined {
  if (!skipBoundsFastPath) {
    const tileBounds = query.getTileBounds(worldX, worldZ);
    if (tileBounds) {
      if (worldY > tileBounds.maxElevation) {
        return worldY - tileBounds.maxElevation;
      }
      if (worldY < tileBounds.minElevation) {
        return worldY - tileBounds.minElevation;
      }
    }
  }
  const elevation = query.getElevation(worldX, worldZ);
  if (!Number.isFinite(elevation)) return undefined;
  return worldY - (elevation as number);
}

type SignedDistanceAt = (px: number, py: number, pz: number) => number | undefined;

/**
 * Generic surface march: step along the ray over `[startT, endT]`, and on a
 * positive→non-positive signed-distance crossing binary-refine the crossing.
 */
function marchSignedDistance(
  ray: Ray,
  startT: number,
  endT: number,
  stepSignedDistanceAt: SignedDistanceAt,
  refineSignedDistanceAt: SignedDistanceAt,
  options: { maxSteps: number; refinementSteps: number },
  point: Vector3,
): number | null {
  let prevT = startT;
  ray.at(prevT, point);
  let prevSignedDistance = stepSignedDistanceAt(point.x, point.y, point.z);

  if (prevSignedDistance !== undefined && prevSignedDistance <= 0) {
    return startT;
  }

  for (let i = 1; i <= options.maxSteps; i += 1) {
    const t = startT + ((endT - startT) * i) / options.maxSteps;
    ray.at(t, point);
    const signedDistance = stepSignedDistanceAt(point.x, point.y, point.z);
    if (signedDistance === undefined) {
      prevSignedDistance = undefined;
      prevT = t;
      continue;
    }

    if (prevSignedDistance !== undefined && prevSignedDistance > 0 && signedDistance <= 0) {
      let lo = prevT;
      let hi = t;
      for (let r = 0; r < options.refinementSteps; r += 1) {
        const mid = (lo + hi) * 0.5;
        ray.at(mid, point);
        const midDistance = refineSignedDistanceAt(point.x, point.y, point.z);
        if (midDistance === undefined) {
          lo = mid;
          continue;
        }
        if (midDistance > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }

    prevSignedDistance = signedDistance;
    prevT = t;
  }

  return null;
}

export function cpuRaycast(
  query: TerrainQuery,
  ray: Ray,
  config: TerrainRaycastConfig,
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
  const startT = Math.max(0, segment.tMin);
  const endT = Math.min(segment.tMax, maxDistance);
  if (endT < startT) return null;

  const point = new Vector3();
  const hitT = marchSignedDistance(
    ray,
    startT,
    endT,
    (px, py, pz) => terrainSignedDistance(query, px, py, pz, false),
    (px, py, pz) => terrainSignedDistance(query, px, py, pz, true),
    {
      maxSteps: Math.max(8, options?.maxSteps ?? 128),
      refinementSteps: Math.max(1, options?.refinementSteps ?? 8),
    },
    point,
  );
  if (hitT === null) return null;

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

export function cpuRaycastBoundsOnly(
  ray: Ray,
  config: TerrainRaycastConfig,
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

function sphereSignedDistance(
  query: TerrainSphereQuery,
  params: SphereRaycastParams,
  px: number,
  py: number,
  pz: number,
  scratchDir: Vector3,
): number | undefined {
  const dx = px - params.centerX;
  const dy = py - params.centerY;
  const dz = pz - params.centerZ;
  const dist = Math.hypot(dx, dy, dz);
  scratchDir.set(dx, dy, dz);
  const elevation = query.getElevationByDirection(scratchDir);
  if (elevation === null) return undefined;
  const s = params.invert ? -1 : 1;
  return s * (dist - (params.radius + s * elevation));
}

export function cubeSphereRaycast(
  query: TerrainSphereQuery,
  ray: Ray,
  params: SphereRaycastParams,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const shell = intersectRaySphere(
    ray,
    params.centerX,
    params.centerY,
    params.centerZ,
    params.maxRadius,
  );
  if (!shell) return null;

  const maxDistance = options?.maxDistance ?? Number.POSITIVE_INFINITY;
  const startT = Math.max(0, shell.t0);
  const endT = Math.min(shell.t1, maxDistance);
  if (endT < startT) return null;

  const scratchDir = new Vector3();
  const point = new Vector3();
  const signedDistanceAt: SignedDistanceAt = (px, py, pz) =>
    sphereSignedDistance(query, params, px, py, pz, scratchDir);

  const hitT = marchSignedDistance(
    ray,
    startT,
    endT,
    signedDistanceAt,
    signedDistanceAt,
    {
      maxSteps: Math.max(8, options?.maxSteps ?? 256),
      refinementSteps: Math.max(1, options?.refinementSteps ?? 12),
    },
    point,
  );
  if (hitT === null) return null;

  ray.at(hitT, point);
  const sample = query.sampleTerrainByPosition(point);
  if (!sample.valid) return null;
  return {
    position: sample.position.clone(),
    normal: sample.normal.clone(),
    distance: ray.origin.distanceTo(sample.position),
  };
}

/** Coarse fallback: intersect the base sphere and return a radial-normal hit. */
export function cubeSphereRaycastBoundsOnly(
  ray: Ray,
  params: SphereRaycastParams,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const shell = intersectRaySphere(ray, params.centerX, params.centerY, params.centerZ, params.radius);
  if (!shell) return null;
  const maxDistance = options?.maxDistance ?? Number.POSITIVE_INFINITY;
  const t = shell.t0 >= 0 ? shell.t0 : shell.t1;
  if (t < 0 || t > maxDistance) return null;
  const point = new Vector3();
  ray.at(t, point);
  const normal = new Vector3(
    point.x - params.centerX,
    point.y - params.centerY,
    point.z - params.centerZ,
  ).normalize();
  if (params.invert) normal.negate();
  return { position: point, normal, distance: ray.origin.distanceTo(point) };
}

function torusSignedDistance(
  query: TerrainSurfaceQuery,
  params: TorusRaycastParams,
  px: number,
  py: number,
  pz: number,
  scratchPoint: Vector3,
  scratchParams: TorusSurfaceParams,
): number | undefined {
  positionToTorusParams(
    px,
    py,
    pz,
    params.majorRadius,
    { x: params.centerX, y: params.centerY, z: params.centerZ },
    scratchParams,
  );
  scratchPoint.set(px, py, pz);
  const elevation = query.getElevationByPosition(scratchPoint);
  if (elevation === null) return undefined;
  const s = params.invert ? -1 : 1;
  return s * (scratchParams.tubeDistance - (params.minorRadius + s * elevation));
}

export function torusRaycast(
  query: TerrainSurfaceQuery,
  ray: Ray,
  params: TorusRaycastParams,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const shell = intersectRaySphere(
    ray,
    params.centerX,
    params.centerY,
    params.centerZ,
    params.outerRadius,
  );
  if (!shell) return null;

  const maxDistance = options?.maxDistance ?? Number.POSITIVE_INFINITY;
  const startT = Math.max(0, shell.t0);
  const endT = Math.min(shell.t1, maxDistance);
  if (endT < startT) return null;

  const scratchPoint = new Vector3();
  const scratchParams: TorusSurfaceParams = { u: 0, v: 0, tubeDistance: 0 };
  const point = new Vector3();
  const signedDistanceAt: SignedDistanceAt = (px, py, pz) =>
    torusSignedDistance(query, params, px, py, pz, scratchPoint, scratchParams);

  const hitT = marchSignedDistance(
    ray,
    startT,
    endT,
    signedDistanceAt,
    signedDistanceAt,
    {
      maxSteps: Math.max(8, options?.maxSteps ?? 256),
      refinementSteps: Math.max(1, options?.refinementSteps ?? 12),
    },
    point,
  );
  if (hitT === null) return null;

  ray.at(hitT, point);
  const sample = query.sampleTerrainByPosition(point);
  if (!sample.valid) return null;
  return {
    position: sample.position.clone(),
    normal: sample.normal.clone(),
    distance: ray.origin.distanceTo(sample.position),
  };
}

/** Coarse fallback: intersect the torus bounding sphere with a radial normal. */
export function torusRaycastBoundsOnly(
  ray: Ray,
  params: TorusRaycastParams,
  options?: RaycastOptions,
): TerrainRaycastResult | null {
  const shell = intersectRaySphere(
    ray,
    params.centerX,
    params.centerY,
    params.centerZ,
    params.outerRadius,
  );
  if (!shell) return null;
  const maxDistance = options?.maxDistance ?? Number.POSITIVE_INFINITY;
  const t = shell.t0 >= 0 ? shell.t0 : shell.t1;
  if (t < 0 || t > maxDistance) return null;
  const point = new Vector3();
  ray.at(t, point);
  const normal = new Vector3(
    point.x - params.centerX,
    point.y - params.centerY,
    point.z - params.centerZ,
  ).normalize();
  if (params.invert) normal.negate();
  return { position: point, normal, distance: ray.origin.distanceTo(point) };
}
