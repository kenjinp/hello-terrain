/**
 * Canonical cube-sphere face basis.
 *
 * Shared single source of truth between the CPU surface topology
 * (`cubeSphere.ts`) and the GPU position/normal assembly (`tsl/cubeSphere.ts`)
 * so both agree on geometry and faces seam correctly.
 *
 * Each face maps a face-local coordinate (u, v) in [0, 1] to a point on the
 * cube `[-1, 1]^3` via:
 *
 *   s = 2u - 1, t = 2v - 1
 *   cube = forward + s * right + t * up
 *
 * Normalizing `cube` yields the unit-sphere direction for that vertex.
 *
 * Bases are right-handed (`forward = right x up`) and outward-facing.
 * Space indices: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z.
 */

export type Vec3 = readonly [number, number, number];

export type CubeFace = {
    forward: Vec3;
    right: Vec3;
    up: Vec3;
};

export const CUBE_FACE_COUNT = 6;

export const CUBE_FACES: readonly CubeFace[] = [
    // 0: +X
    { forward: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
    // 1: -X
    { forward: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
    // 2: +Y (north pole)
    { forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
    // 3: -Y (south pole)
    { forward: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
    // 4: +Z
    { forward: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
    // 5: -Z
    { forward: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
] as const;
