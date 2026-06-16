import { cos, float, sin, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

/**
 * GPU torus mapping helpers.
 *
 * These mirror the CPU torus math in `quadtree/topology/torusInverse.ts` so the
 * positions/normals assembled on the GPU agree with the CPU LOD topology and
 * query mirror. `majorRadius`/`minorRadius` are baked as constants at
 * graph-build time (the topology is rebuilt when they change).
 */

const TWO_PI = Math.PI * 2;

export type TorusGeometry = {
  majorRadius: number;
  minorRadius: number;
  center: { x: number; y: number; z: number };
};

/**
 * Torus surface point for face-local (u, v) in [0, 1], displaced radially in
 * the tube by `displacement`.
 *
 *   theta = 2*pi*u  (around +Y, from +Z toward +X)
 *   phi   = 2*pi*v  (around the tube; phi = 0 outward in XZ, pi/2 toward +Y)
 */
export function torusPosition(
  geometry: TorusGeometry,
  u: Node,
  v: Node,
  displacement: Node,
): Node {
  const theta = float(u).mul(TWO_PI);
  const phi = float(v).mul(TWO_PI);
  const sinT = sin(theta);
  const cosT = cos(theta);
  const sinP = sin(phi);
  const cosP = cos(phi);
  const tube = displacement.add(float(geometry.minorRadius));
  const ring = tube.mul(cosP).add(float(geometry.majorRadius));
  return vec3(
    ring.mul(sinT).add(float(geometry.center.x)),
    tube.mul(sinP).add(float(geometry.center.y)),
    ring.mul(cosT).add(float(geometry.center.z)),
  );
}

/** Outward unit surface normal of the base torus at (u, v). */
export function torusOutwardNormal(u: Node, v: Node): Node {
  const theta = float(u).mul(TWO_PI);
  const phi = float(v).mul(TWO_PI);
  const sinT = sin(theta);
  const cosT = cos(theta);
  const sinP = sin(phi);
  const cosP = cos(phi);
  return vec3(cosP.mul(sinT), sinP, cosP.mul(cosT)).normalize();
}
