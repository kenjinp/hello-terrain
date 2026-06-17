export type Vec3Mutable = [number, number, number];

const TWO_PI = Math.PI * 2;

/** Wrap a value into [0, 1). */
export function wrap01(t: number): number {
  const w = t - Math.floor(t);
  // Guard against -0 / rounding landing exactly on 1.
  return w >= 1 ? w - 1 : w;
}

/**
 * Torus surface point for parameters (u, v) in [0, 1].
 *
 * Convention (matches `latLongToDirection`'s longitude axis):
 * - `theta = 2*pi*u` sweeps around the +Y axis, measured from +Z toward +X.
 * - `phi = 2*pi*v` sweeps around the tube cross-section, `phi = 0` pointing
 *   radially outward in the XZ plane and `phi = pi/2` pointing toward +Y.
 *
 * `displacement` is the elevation added to the tube (minor) radius.
 */
export function torusUVToPoint(
  u: number,
  v: number,
  majorRadius: number,
  minorRadius: number,
  displacement: number,
  center: { x: number; y: number; z: number },
  out: Vec3Mutable,
  invert = false,
): void {
  const theta = TWO_PI * u;
  const phi = TWO_PI * v;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const disp = invert ? -displacement : displacement;
  const tube = minorRadius + disp;
  const ring = majorRadius + tube * cosP;
  out[0] = center.x + ring * sinT;
  out[1] = center.y + tube * sinP;
  out[2] = center.z + ring * cosT;
}

/** Outward unit surface normal of the base (undisplaced) torus at (u, v). */
export function torusOutwardNormal(u: number, v: number, out: Vec3Mutable, invert = false): void {
  const theta = TWO_PI * u;
  const phi = TWO_PI * v;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const s = invert ? -1 : 1;
  out[0] = cosP * sinT * s;
  out[1] = sinP * s;
  out[2] = cosP * cosT * s;
}

export type TorusSurfaceParams = {
  /** Wrapped major-circle parameter in [0, 1). */
  u: number;
  /** Wrapped tube parameter in [0, 1). */
  v: number;
  /** Distance from the point to the tube center circle. */
  tubeDistance: number;
};

/**
 * Map a world point to torus surface parameters. `tubeDistance - minorRadius`
 * is the signed radial displacement of the point relative to the base torus.
 */
export function positionToTorusParams(
  px: number,
  py: number,
  pz: number,
  majorRadius: number,
  center: { x: number; y: number; z: number },
  out: TorusSurfaceParams,
): void {
  const qx = px - center.x;
  const qy = py - center.y;
  const qz = pz - center.z;
  const theta = Math.atan2(qx, qz);
  const rho = Math.hypot(qx, qz);
  const a = rho - majorRadius;
  const phi = Math.atan2(qy, a);
  out.u = wrap01(theta / TWO_PI);
  out.v = wrap01(phi / TWO_PI);
  out.tubeDistance = Math.hypot(a, qy);
}
