import { Dir, type Surface, type TileBounds, type TileId } from "../types";

export type CubeSphereSurfaceConfig = {
  radius: number;
  maxHeight?: number;
};

/**
 * Maps face-local UV [0,1]² to a 3D cube point.
 *
 * Face UV convention (u increases rightward, v increases downward):
 *   Face 0 (+X): ( 1, -t, -s)
 *   Face 1 (-X): (-1, -t,  s)
 *   Face 2 (+Y): ( s,  1,  t)
 *   Face 3 (-Y): ( s, -1, -t)
 *   Face 4 (+Z): ( s, -t,  1)
 *   Face 5 (-Z): (-s, -t, -1)
 *
 * where s = 2u - 1, t = 2v - 1.
 */
export function faceToCube(face: number, u: number, v: number): { x: number; y: number; z: number } {
  const s = 2 * u - 1;
  const t = 2 * v - 1;
  switch (face) {
    case 0:
      return { x: 1, y: -t, z: -s };
    case 1:
      return { x: -1, y: -t, z: s };
    case 2:
      return { x: s, y: 1, z: t };
    case 3:
      return { x: s, y: -1, z: -t };
    case 4:
      return { x: s, y: -t, z: 1 };
    case 5:
      return { x: -s, y: -t, z: -1 };
    default:
      return { x: 0, y: 0, z: 0 };
  }
}

function normalize(p: { x: number; y: number; z: number }, radius: number): { x: number; y: number; z: number } {
  const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  const inv = radius / len;
  return { x: p.x * inv, y: p.y * inv, z: p.z * inv };
}

/**
 * Face-edge adjacency table.
 *
 * For each face [0..5] and direction [LEFT=0, RIGHT=1, TOP=2, BOTTOM=3],
 * stores the neighbor face and a coordinate remap function.
 *
 * The remap function takes (parallelCoord, maxCoord) from the source edge
 * and returns the (x, y) tile coordinates on the target face.
 */
type EdgeRemap = (parallel: number, maxCoord: number) => { x: number; y: number };

const ADJACENCY: Array<[number, EdgeRemap][]> = [
  // Face 0 (+X)
  [
    /* LEFT   */ [4, (y, m) => ({ x: m, y })],
    /* RIGHT  */ [5, (y, _m) => ({ x: 0, y })],
    /* TOP    */ [2, (x, m) => ({ x: m, y: m - x })],
    /* BOTTOM */ [3, (x, m) => ({ x: m, y: x })],
  ],
  // Face 1 (-X)
  [
    /* LEFT   */ [5, (y, m) => ({ x: m, y })],
    /* RIGHT  */ [4, (y, _m) => ({ x: 0, y })],
    /* TOP    */ [2, (x, _m) => ({ x: 0, y: x })],
    /* BOTTOM */ [3, (x, m) => ({ x: 0, y: m - x })],
  ],
  // Face 2 (+Y)
  [
    /* LEFT   */ [1, (y, _m) => ({ x: y, y: 0 })],
    /* RIGHT  */ [0, (y, m) => ({ x: m - y, y: 0 })],
    /* TOP    */ [5, (x, m) => ({ x: m - x, y: 0 })],
    /* BOTTOM */ [4, (x, _m) => ({ x: x, y: 0 })],
  ],
  // Face 3 (-Y)
  [
    /* LEFT   */ [1, (y, m) => ({ x: m - y, y: m })],
    /* RIGHT  */ [0, (y, m) => ({ x: y, y: m })],
    /* TOP    */ [4, (x, m) => ({ x: x, y: m })],
    /* BOTTOM */ [5, (x, m) => ({ x: m - x, y: m })],
  ],
  // Face 4 (+Z)
  [
    /* LEFT   */ [1, (y, m) => ({ x: m, y })],
    /* RIGHT  */ [0, (y, _m) => ({ x: 0, y })],
    /* TOP    */ [2, (x, m) => ({ x: x, y: m })],
    /* BOTTOM */ [3, (x, _m) => ({ x: x, y: 0 })],
  ],
  // Face 5 (-Z)
  [
    /* LEFT   */ [0, (y, m) => ({ x: m, y })],
    /* RIGHT  */ [1, (y, _m) => ({ x: 0, y })],
    /* TOP    */ [2, (x, m) => ({ x: m - x, y: 0 })],
    /* BOTTOM */ [3, (x, m) => ({ x: m - x, y: m })],
  ],
];

export function createCubeSphereSurface(cfg: CubeSphereSurfaceConfig): Surface {
  const radius = cfg.radius;
  const maxHeight = cfg.maxHeight ?? 0;

  return {
    spaceCount: 6,
    maxRootCount: 6,

    neighborSameLevel(tile: TileId, dir: Dir, out: TileId): boolean {
      const level = tile.level;
      const maxCoord = (1 << level) - 1;

      let nx = tile.x;
      let ny = tile.y;
      switch (dir) {
        case Dir.LEFT:
          nx = tile.x - 1;
          break;
        case Dir.RIGHT:
          nx = tile.x + 1;
          break;
        case Dir.TOP:
          ny = tile.y - 1;
          break;
        case Dir.BOTTOM:
          ny = tile.y + 1;
          break;
      }

      // Interior neighbor — stays on the same face.
      if (nx >= 0 && nx <= maxCoord && ny >= 0 && ny <= maxCoord) {
        out.space = tile.space;
        out.level = level;
        out.x = nx;
        out.y = ny;
        return true;
      }

      // Cross-face neighbor — look up adjacency table.
      const faceAdj = ADJACENCY[tile.space];
      if (!faceAdj) return false;
      const [neighborFace, remap] = faceAdj[dir];

      // The "parallel" coordinate is the one that stays on the shared edge.
      let parallel: number;
      switch (dir) {
        case Dir.LEFT:
        case Dir.RIGHT:
          parallel = tile.y;
          break;
        case Dir.TOP:
        case Dir.BOTTOM:
          parallel = tile.x;
          break;
      }

      const target = remap(parallel, maxCoord);
      out.space = neighborFace;
      out.level = level;
      out.x = target.x;
      out.y = target.y;
      return true;
    },

    tileBounds(tile: TileId, cameraOrigin: { x: number; y: number; z: number }, out: TileBounds): void {
      const level = tile.level;
      const tilesPerEdge = 1 << level;

      // Face UV for tile center.
      const uCenter = (tile.x + 0.5) / tilesPerEdge;
      const vCenter = (tile.y + 0.5) / tilesPerEdge;
      const center3D = normalize(faceToCube(tile.space, uCenter, vCenter), radius);

      // Face UV for all 4 corners — used for conservative bounding radius.
      const u0 = tile.x / tilesPerEdge;
      const u1 = (tile.x + 1) / tilesPerEdge;
      const v0 = tile.y / tilesPerEdge;
      const v1 = (tile.y + 1) / tilesPerEdge;

      const c0 = normalize(faceToCube(tile.space, u0, v0), radius);
      const c1 = normalize(faceToCube(tile.space, u1, v0), radius);
      const c2 = normalize(faceToCube(tile.space, u0, v1), radius);
      const c3 = normalize(faceToCube(tile.space, u1, v1), radius);

      let maxDist = 0;
      for (const c of [c0, c1, c2, c3]) {
        const dx = c.x - center3D.x;
        const dy = c.y - center3D.y;
        const dz = c.z - center3D.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > maxDist) maxDist = dist;
      }

      out.cx = center3D.x - cameraOrigin.x;
      out.cy = center3D.y - cameraOrigin.y;
      out.cz = center3D.z - cameraOrigin.z;
      out.r = maxDist + maxHeight;
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
  };
}
