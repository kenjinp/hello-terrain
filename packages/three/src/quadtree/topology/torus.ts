import { createTorusProjection } from "../../projection/torus";
import { Dir, type ElevationRangeOut, type TileBounds, type TileId, type Topology } from "../types";
import { type Vec3Mutable, torusUVToPoint } from "./torusInverse";

export type TorusTopologyConfig = {
  /** Distance from the torus center to the tube center (the donut radius). */
  majorRadius: number;
  /** Radius of the tube cross-section. */
  minorRadius: number;
  /** Torus center in world space (defaults to origin). */
  center?: { x: number; y: number; z: number };
  /** When true, elevation displaces inward and skirts point outward. */
  invert?: boolean;
};

/**
 * Torus (donut) topology: a single quadtree space whose `(u, v)` axes wrap
 * around the major circle and the tube cross-section. Both axes are periodic,
 * so every same-level neighbor exists (wrapping modulo the level resolution).
 *
 * Level-0 resolution is anisotropic: `baseU = round(major/minor)` tiles along
 * `u` and `baseV = 1` along `v`, so root tiles are approximately square in
 * world space before isotropic LOD subdivision.
 */
export function createTorusTopology(cfg: TorusTopologyConfig): Topology {
  const majorRadius = cfg.majorRadius;
  const minorRadius = cfg.minorRadius;
  const center = cfg.center ?? { x: 0, y: 0, z: 0 };
  const invert = cfg.invert ?? false;
  const baseU = Math.max(1, Math.round(majorRadius / minorRadius));
  const baseV = 1;

  const corner: Vec3Mutable = [0, 0, 0];
  const px = new Float64Array(18);
  const py = new Float64Array(18);
  const pz = new Float64Array(18);
  // Datum-shell sample grid, reused for the footprint (LOD size) reduction.
  const fpx = new Float64Array(9);
  const fpy = new Float64Array(9);
  const fpz = new Float64Array(9);

  const wrap = (value: number, n: number): number => ((value % n) + n) % n;

  const levelResolution = (level: number): { nU: number; nV: number } => {
    const levelScale = 2 ** level;
    return { nU: baseU * levelScale, nV: baseV * levelScale };
  };

  return {
    spaceCount: 1,
    maxRootCount: baseU * baseV,
    projection: createTorusProjection({
      majorRadius,
      minorRadius,
      center,
      invert,
      baseU,
      baseV,
    }),
    radius: majorRadius + minorRadius,
    center,

    neighborSameLevel(tile: TileId, dir: Dir, out: TileId): boolean {
      const { nU, nV } = levelResolution(tile.level);
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
      out.level = tile.level;
      out.x = wrap(nx, nU);
      out.y = wrap(ny, nV);
      return true;
    },

    tileBounds(
      tile: TileId,
      cameraOrigin: { x: number; y: number; z: number },
      out: TileBounds,
      elevationRange?: ElevationRangeOut,
    ): void {
      const { nU, nV } = levelResolution(tile.level);
      const u0 = tile.x / nU;
      const v0 = tile.y / nV;
      const stepU = 1 / nU;
      const stepV = 1 / nV;

      // LOD size: footprint of the datum-shell sample grid (no displacement).
      let fpSumX = 0;
      let fpSumY = 0;
      let fpSumZ = 0;
      let fpCount = 0;
      for (let sj = 0; sj <= 2; sj++) {
        for (let si = 0; si <= 2; si++) {
          const u = u0 + (si * stepU) / 2;
          const v = v0 + (sj * stepV) / 2;
          torusUVToPoint(u, v, majorRadius, minorRadius, 0, center, corner, invert);
          fpx[fpCount] = corner[0];
          fpy[fpCount] = corner[1];
          fpz[fpCount] = corner[2];
          fpSumX += corner[0];
          fpSumY += corner[1];
          fpSumZ += corner[2];
          fpCount += 1;
        }
      }
      const fpCx = fpSumX / fpCount;
      const fpCy = fpSumY / fpCount;
      const fpCz = fpSumZ / fpCount;
      let fpMaxDistSq = 0;
      for (let i = 0; i < fpCount; i++) {
        const dx = fpx[i]! - fpCx;
        const dy = fpy[i]! - fpCy;
        const dz = fpz[i]! - fpCz;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > fpMaxDistSq) fpMaxDistSq = dSq;
      }
      out.lodRadius = Math.sqrt(fpMaxDistSq);

      // Conservative radius: bounding sphere over both displaced shells.
      const disps = elevationRange ? [elevationRange.min, elevationRange.max] : [0];
      let pointCount = 0;
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;

      for (let sj = 0; sj <= 2; sj++) {
        for (let si = 0; si <= 2; si++) {
          const u = u0 + (si * stepU) / 2;
          const v = v0 + (sj * stepV) / 2;
          for (let di = 0; di < disps.length; di++) {
            torusUVToPoint(u, v, majorRadius, minorRadius, disps[di]!, center, corner, invert);
            px[pointCount] = corner[0];
            py[pointCount] = corner[1];
            pz[pointCount] = corner[2];
            sumX += corner[0];
            sumY += corner[1];
            sumZ += corner[2];
            pointCount += 1;
          }
        }
      }

      const cX = sumX / pointCount;
      const cY = sumY / pointCount;
      const cZ = sumZ / pointCount;

      let maxDistSq = 0;
      for (let i = 0; i < pointCount; i++) {
        const dx = px[i]! - cX;
        const dy = py[i]! - cY;
        const dz = pz[i]! - cZ;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > maxDistSq) maxDistSq = dSq;
      }

      out.cx = cX - cameraOrigin.x;
      out.cy = cY - cameraOrigin.y;
      out.cz = cZ - cameraOrigin.z;
      out.r = Math.sqrt(maxDistSq);
    },

    rootTiles(_cameraOrigin: { x: number; y: number; z: number }, out: TileId[]): number {
      let count = 0;
      for (let y = 0; y < baseV; y++) {
        for (let x = 0; x < baseU; x++) {
          const root = out[count]!;
          root.space = 0;
          root.level = 0;
          root.x = x;
          root.y = y;
          count += 1;
        }
      }
      return count;
    },
  };
}
