import { CUBE_FACES, type Vec3 } from "./cubeSphereFaces";

export type Vec3Mutable = [number, number, number];

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Cube-space point for a face-local coordinate (u, v) in [0, 1]:
 *   cube = forward + (2u-1) * right + (2v-1) * up
 * The result is unnormalized; normalize it to obtain the sphere direction.
 */
export function faceUVToCube(face: number, u: number, v: number, out: Vec3Mutable): void {
  const f = CUBE_FACES[face];
  const s = 2 * u - 1;
  const t = 2 * v - 1;
  out[0] = f.forward[0] + s * f.right[0] + t * f.up[0];
  out[1] = f.forward[1] + s * f.right[1] + t * f.up[1];
  out[2] = f.forward[2] + s * f.right[2] + t * f.up[2];
}

/** Pick the cube face whose normal axis dominates the direction. */
export function directionToFace(d: Vec3): number {
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  if (ax >= ay && ax >= az) return d[0] >= 0 ? 0 : 1;
  if (ay >= ax && ay >= az) return d[1] >= 0 ? 2 : 3;
  return d[2] >= 0 ? 4 : 5;
}

/** Face-local (u, v) in [0, 1] for a direction known to fall on `face`. */
export function directionToFaceUV(face: number, d: Vec3, out: [number, number]): void {
  const f = CUBE_FACES[face];
  const denom = dot(d, f.forward);
  const inv = 1 / denom;
  const px = d[0] * inv;
  const py = d[1] * inv;
  const pz = d[2] * inv;
  const p: Vec3 = [px, py, pz];
  const s = dot(p, f.right);
  const t = dot(p, f.up);
  out[0] = (s + 1) * 0.5;
  out[1] = (t + 1) * 0.5;
}

/**
 * Convert latitude/longitude (degrees) to a unit sphere direction.
 *
 * Convention matches `CUBE_FACES` (+Y is the north pole):
 * - latitude is the angle above the equator, in `[-90, 90]`
 * - longitude is the angle around the +Y axis, in `[-180, 180]`,
 *   measured from +Z toward +X (lon = 0 points along +Z).
 */
export function latLongToDirection(latDeg: number, lonDeg: number, out: Vec3Mutable): void {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const cosLat = Math.cos(lat);
  out[0] = cosLat * Math.sin(lon);
  out[1] = Math.sin(lat);
  out[2] = cosLat * Math.cos(lon);
}

/** Inverse of {@link latLongToDirection}; returns degrees. */
export function directionToLatLong(d: Vec3): { latitude: number; longitude: number } {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const y = Math.max(-1, Math.min(1, d[1] / len));
  return {
    latitude: Math.asin(y) * RAD_TO_DEG,
    longitude: Math.atan2(d[0], d[2]) * RAD_TO_DEG,
  };
}
