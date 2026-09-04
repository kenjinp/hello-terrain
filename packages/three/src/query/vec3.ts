import type { RayLike, Vec3Like } from "../projection/types";

/**
 * Allocation-free plain-object vector math for the CPU query / raycast /
 * projection internals. Every function writes into a caller-provided `out`
 * (callers own their scratch; no module-scope state) and returns it.
 *
 * The formulas intentionally mirror three's `Vector3` / `Ray` so results are
 * bit-identical to the previous implementation; three.js itself is only
 * touched at the consumer boundary (`terrain-query.ts`, `terrain-raycast.ts`,
 * the public `CpuTerrainCache` methods).
 */

/** Allocate a fresh plain vector (for per-instance scratch). */
export function vec3(x = 0, y = 0, z = 0): Vec3Like {
  return { x, y, z };
}

export function vec3Set(out: Vec3Like, x: number, y: number, z: number): Vec3Like {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function vec3Copy(out: Vec3Like, a: Vec3Like): Vec3Like {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function vec3Add(a: Vec3Like, b: Vec3Like, out: Vec3Like): Vec3Like {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function vec3Sub(a: Vec3Like, b: Vec3Like, out: Vec3Like): Vec3Like {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function vec3Scale(a: Vec3Like, s: number, out: Vec3Like): Vec3Like {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

export function vec3Dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(a: Vec3Like, b: Vec3Like, out: Vec3Like): Vec3Like {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function vec3LengthSq(a: Vec3Like): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

/** Same formula as `Vector3.length()` (`sqrt` of the summed squares, not `hypot`). */
export function vec3Length(a: Vec3Like): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

/** Same formula as `Vector3.distanceTo()`. */
export function vec3Distance(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Normalize `a` into `out`. Mirrors `Vector3.normalize()`: a zero-length
 * vector is left as-is (`length() || 1`) and the components are multiplied by
 * the reciprocal length (`divideScalar` → `multiplyScalar(1 / s)`).
 */
export function vec3Normalize(a: Vec3Like, out: Vec3Like): Vec3Like {
  const inv = 1 / (vec3Length(a) || 1);
  out.x = a.x * inv;
  out.y = a.y * inv;
  out.z = a.z * inv;
  return out;
}

/** Point along a ray: `origin + direction * t` (mirrors `Ray.at()`). */
export function rayAt(ray: RayLike, t: number, out: Vec3Like): Vec3Like {
  out.x = ray.origin.x + ray.direction.x * t;
  out.y = ray.origin.y + ray.direction.y * t;
  out.z = ray.origin.z + ray.direction.z * t;
  return out;
}
