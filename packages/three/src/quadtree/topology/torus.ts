import { createTorusProjection } from "../../projection/torus";
import { Dir, type TileBounds, type TileId, type Topology } from "../types";
import { type Vec3Mutable, torusUVToPoint } from "./torusInverse";

export type TorusTopologyConfig = {
  /** Distance from the torus center to the tube center (the donut radius). */
  majorRadius: number;
  /** Radius of the tube cross-section. */
  minorRadius: number;
  /** Torus center in world space (defaults to origin). */
  center?: { x: number; y: number; z: number };
  /** Optional conservative vertical/tube extent, included in bounds radius. */
  maxHeight?: number;
  /** When true, elevation displaces inward and skirts point outward. */
  invert?: boolean;
};

/**
 * Torus (donut) topology: a single quadtree space whose `(u, v)` axes wrap
 * around the major circle and the tube cross-section. Both axes are periodic,
 * so every same-level neighbor exists (wrapping modulo the level resolution)
 * and there is a single root tile.
 */
export function createTorusTopology(cfg: TorusTopologyConfig): Topology {
  const majorRadius = cfg.majorRadius;
  const minorRadius = cfg.minorRadius;
  const maxHeight = cfg.maxHeight ?? 0;
  const center = cfg.center ?? { x: 0, y: 0, z: 0 };

  const corner: Vec3Mutable = [0, 0, 0];

  const wrap = (value: number, n: number): number => ((value % n) + n) % n;

  return {
    spaceCount: 1,
    maxRootCount: 1,
    projection: createTorusProjection({
      majorRadius,
      minorRadius,
      center,
      invert: cfg.invert,
    }),
    radius: majorRadius + minorRadius,
    center,

    neighborSameLevel(tile: TileId, dir: Dir, out: TileId): boolean {
      const level = tile.level;
      const n = 1 << level;
      let nx = tile.x;
      let ny = tile.y;

      switch (dir) {
        case Dir.LEFT:
          nx -= 1;
          break;
        case Dir.RIGHT:
          nx += 1;
          break;
        case Dir.TOP:
          ny -= 1;
          break;
        case Dir.BOTTOM:
          ny += 1;
          break;
      }

      // Closed in both axes: wrap to the opposite edge.
      out.space = 0;
      out.level = level;
      out.x = wrap(nx, n);
      out.y = wrap(ny, n);
      return true;
    },

    tileBounds(tile: TileId, cameraOrigin: { x: number; y: number; z: number }, out: TileBounds): void {
      const level = tile.level;
      const n = 1 << level;
      const u0 = tile.x / n;
      const v0 = tile.y / n;
      const step = 1 / n;

      // Sample a 3x3 grid across the tile (corners + edge midpoints + center).
      // Because both axes are periodic, the four corners can collapse to a
      // single point at low levels (a tile spanning a full circle), so corners
      // alone underestimate the extent; the midpoints keep the bound
      // conservative.
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      const px: number[] = [];
      const py: number[] = [];
      const pz: number[] = [];
      for (let sj = 0; sj <= 2; sj++) {
        for (let si = 0; si <= 2; si++) {
          const u = u0 + (si * step) / 2;
          const v = v0 + (sj * step) / 2;
          torusUVToPoint(u, v, majorRadius, minorRadius, 0, center, corner);
          px.push(corner[0]);
          py.push(corner[1]);
          pz.push(corner[2]);
          sumX += corner[0];
          sumY += corner[1];
          sumZ += corner[2];
        }
      }

      const count = px.length;
      const cX = sumX / count;
      const cY = sumY / count;
      const cZ = sumZ / count;

      let maxDistSq = 0;
      for (let i = 0; i < count; i++) {
        const dx = px[i]! - cX;
        const dy = py[i]! - cY;
        const dz = pz[i]! - cZ;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > maxDistSq) maxDistSq = dSq;
      }

      out.cx = cX - cameraOrigin.x;
      out.cy = cY - cameraOrigin.y;
      out.cz = cZ - cameraOrigin.z;
      out.r = Math.sqrt(maxDistSq) + maxHeight;
    },

    rootTiles(_cameraOrigin: { x: number; y: number; z: number }, out: TileId[]): number {
      const root = out[0]!;
      root.space = 0;
      root.level = 0;
      root.x = 0;
      root.y = 0;
      return 1;
    },
  };
}
