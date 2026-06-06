import { type Surface, type TileBounds, type TileId } from "../types";
import { CUBE_FACES, type Vec3 } from "./cubeSphereFaces";

export type CubeSphereSurfaceConfig = {
  /** Sphere radius in world units. */
  radius: number;
  /** Planet center in world space (defaults to origin). */
  center?: { x: number; y: number; z: number };
  /** Optional conservative vertical extent, included in bounds radius. */
  maxHeight?: number;
};

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Cube-space point for a face-local coordinate (u, v) in [0, 1]. */
function faceCube(face: number, u: number, v: number, out: Vec3Mutable): void {
  const f = CUBE_FACES[face];
  const s = 2 * u - 1;
  const t = 2 * v - 1;
  out[0] = f.forward[0] + s * f.right[0] + t * f.up[0];
  out[1] = f.forward[1] + s * f.right[1] + t * f.up[1];
  out[2] = f.forward[2] + s * f.right[2] + t * f.up[2];
}

type Vec3Mutable = [number, number, number];

/** Pick the cube face whose normal axis dominates the direction. */
function dirToFace(d: Vec3): number {
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  if (ax >= ay && ax >= az) return d[0] >= 0 ? 0 : 1;
  if (ay >= ax && ay >= az) return d[1] >= 0 ? 2 : 3;
  return d[2] >= 0 ? 4 : 5;
}

/** Face-local (u, v) in [0, 1] for a direction known to fall on `face`. */
function faceUV(face: number, d: Vec3, out: [number, number]): void {
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
 * Cube-sphere surface: six quadtree faces wrapped onto a sphere.
 *
 * Topology (`neighborSameLevel`) is derived numerically from the shared
 * `CUBE_FACES` basis so cross-face edges (including rotated pole edges)
 * resolve to the correct neighbor tile without hand-coded transforms.
 */
export function createCubeSphereSurface(cfg: CubeSphereSurfaceConfig): Surface {
  const radius = cfg.radius;
  const maxHeight = cfg.maxHeight ?? 0;
  const center = cfg.center ?? { x: 0, y: 0, z: 0 };

  const cube: Vec3Mutable = [0, 0, 0];
  const uv: [number, number] = [0, 0];

  function crossFaceNeighbor(
    face: number,
    level: number,
    nx: number,
    ny: number,
    out: TileId,
  ): void {
    const n = 1 << level;
    // Continuous center of the (out-of-range) neighbor tile in this face's UV.
    const u = (nx + 0.5) / n;
    const v = (ny + 0.5) / n;
    faceCube(face, u, v, cube);
    const len = Math.hypot(cube[0], cube[1], cube[2]);
    const dir: Vec3 = [cube[0] / len, cube[1] / len, cube[2] / len];
    const nbrFace = dirToFace(dir);
    faceUV(nbrFace, dir, uv);
    let bx = Math.floor(uv[0] * n);
    let by = Math.floor(uv[1] * n);
    if (bx < 0) bx = 0;
    else if (bx > n - 1) bx = n - 1;
    if (by < 0) by = 0;
    else if (by > n - 1) by = n - 1;
    out.space = nbrFace;
    out.level = level;
    out.x = bx;
    out.y = by;
  }

  return {
    spaceCount: 6,
    maxRootCount: 6,

    neighborSameLevel(tile: TileId, dir: 0 | 1 | 2 | 3, out: TileId): boolean {
      const level = tile.level;
      const n = 1 << level;
      let nx = tile.x;
      let ny = tile.y;

      switch (dir) {
        case 0: // LEFT
          nx -= 1;
          break;
        case 1: // RIGHT
          nx += 1;
          break;
        case 2: // TOP
          ny -= 1;
          break;
        case 3: // BOTTOM
          ny += 1;
          break;
      }

      if (nx >= 0 && ny >= 0 && nx < n && ny < n) {
        out.space = tile.space;
        out.level = level;
        out.x = nx;
        out.y = ny;
        return true;
      }

      crossFaceNeighbor(tile.space, level, nx, ny, out);
      return true;
    },

    tileBounds(tile: TileId, cameraOrigin: { x: number; y: number; z: number }, out: TileBounds): void {
      const level = tile.level;
      const n = 1 << level;
      const u0 = tile.x / n;
      const u1 = (tile.x + 1) / n;
      const v0 = tile.y / n;
      const v1 = (tile.y + 1) / n;

      // World positions of the four tile corners on the sphere.
      const cornersU = [u0, u1, u0, u1];
      const cornersV = [v0, v0, v1, v1];
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      const px: number[] = [0, 0, 0, 0];
      const py: number[] = [0, 0, 0, 0];
      const pz: number[] = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        faceCube(tile.space, cornersU[i], cornersV[i], cube);
        const len = Math.hypot(cube[0], cube[1], cube[2]);
        const sx = center.x + (cube[0] / len) * radius;
        const sy = center.y + (cube[1] / len) * radius;
        const sz = center.z + (cube[2] / len) * radius;
        px[i] = sx;
        py[i] = sy;
        pz[i] = sz;
        sumX += sx;
        sumY += sy;
        sumZ += sz;
      }

      const cX = sumX * 0.25;
      const cY = sumY * 0.25;
      const cZ = sumZ * 0.25;

      let maxDistSq = 0;
      for (let i = 0; i < 4; i++) {
        const dx = px[i] - cX;
        const dy = py[i] - cY;
        const dz = pz[i] - cZ;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > maxDistSq) maxDistSq = dSq;
      }

      out.cx = cX - cameraOrigin.x;
      out.cy = cY - cameraOrigin.y;
      out.cz = cZ - cameraOrigin.z;
      out.r = Math.sqrt(maxDistSq) + maxHeight;
    },

    rootTiles(_cameraOrigin: { x: number; y: number; z: number }, out: TileId[]): number {
      for (let s = 0; s < 6; s++) {
        const root = out[s];
        root.space = s;
        root.level = 0;
        root.x = 0;
        root.y = 0;
      }
      return 6;
    },

    projection: "cubeSphere",
    radius,
  };
}
