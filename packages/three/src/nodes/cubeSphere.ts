import { float, int, select, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { CUBE_FACES, type Vec3 } from "../quadtree/surface/cubeSphereFaces";

/**
 * GPU cube-sphere mapping helpers.
 *
 * These mirror the CPU topology in `quadtree/surface/cubeSphere.ts` by reading
 * the shared `CUBE_FACES` basis, so positions/normals computed on the GPU agree
 * with the LOD topology computed on the CPU.
 *
 * Face index is dynamic per instance (read from the leaf storage), so the basis
 * vectors are selected at runtime via `select` chains built from `CUBE_FACES`
 * at graph-build time.
 */

function vec3Const(v: Vec3): Node {
  return vec3(float(v[0]), float(v[1]), float(v[2]));
}

function selectFaceVec3(face: Node, pick: (f: (typeof CUBE_FACES)[number]) => Vec3): Node {
  const last = CUBE_FACES.length - 1;
  let acc: Node = vec3Const(pick(CUBE_FACES[last]));
  for (let i = last - 1; i >= 0; i--) {
    acc = select(int(face).equal(int(i)), vec3Const(pick(CUBE_FACES[i])), acc) as Node;
  }
  return acc;
}

export type CubeFaceBasis = {
  forward: Node;
  right: Node;
  up: Node;
};

/** Per-face basis vectors selected by the dynamic face index. */
export function cubeFaceBasis(face: Node): CubeFaceBasis {
  return {
    forward: selectFaceVec3(face, (f) => f.forward),
    right: selectFaceVec3(face, (f) => f.right),
    up: selectFaceVec3(face, (f) => f.up),
  };
}

/**
 * Cube-space point for face-local (u, v) in [0, 1]:
 *   cube = forward + (2u-1) * right + (2v-1) * up
 */
export function cubeFacePoint(basis: CubeFaceBasis, u: Node, v: Node): Node {
  const s = float(u).mul(2).sub(1);
  const t = float(v).mul(2).sub(1);
  return basis.forward.add(basis.right.mul(s)).add(basis.up.mul(t));
}

/** Unit-sphere direction for face-local (u, v). */
export function cubeFaceDirection(basis: CubeFaceBasis, u: Node, v: Node): Node {
  return cubeFacePoint(basis, u, v).normalize();
}

/**
 * Project a basis axis onto the tangent plane at `dir` and normalize.
 * Used to build the sphere tangent frame for normal reconstruction.
 */
export function tangentFromAxis(dir: Node, axis: Node): Node {
  return axis.sub(dir.mul(dir.dot(axis))).normalize();
}
