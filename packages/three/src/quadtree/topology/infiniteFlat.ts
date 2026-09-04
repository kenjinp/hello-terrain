import { createFlatProjection } from "../../projection/flat";
import { boundingSphereFromPoints } from "../bounds";
import { Dir, type ElevationRangeOut, type TileBounds, type TileId, type Topology } from "../types";

export type InfiniteFlatTopologyConfig = {
  rootSize: number;
  origin: { x: number; y: number; z: number };
  /** half-width of root grid in root tiles (1 => 3x3 roots) */
  rootGridRadius?: number;
};

export function createInfiniteFlatTopology(cfg: InfiniteFlatTopologyConfig): Topology {
  const halfRoot = 0.5 * cfg.rootSize;
  const rootGridRadius = Math.max(0, Math.floor(cfg.rootGridRadius ?? 1));
  const rootWidth = rootGridRadius * 2 + 1;
  // Scratch for the 4 tile corners × {min, max} elevation samples.
  const px = new Float64Array(8);
  const py = new Float64Array(8);
  const pz = new Float64Array(8);

  return {
    spaceCount: 1,
    maxRootCount: rootWidth * rootWidth,
    projection: createFlatProjection(),
    rootSize: cfg.rootSize,
    origin: cfg.origin,

    neighborSameLevel(tile: TileId, dir: Dir, out: TileId): boolean {
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

      out.space = tile.space;
      out.level = tile.level;
      out.x = nx;
      out.y = ny;
      return true;
    },

    tileBounds(
      tile: TileId,
      cameraOrigin: { x: number; y: number; z: number },
      out: TileBounds,
      elevationRange?: ElevationRangeOut,
    ): void {
      const level = tile.level;
      const scale = 1 / (1 << level);
      const size = cfg.rootSize * scale;

      const minX = cfg.origin.x + (tile.x * size - halfRoot);
      const minZ = cfg.origin.z + (tile.y * size - halfRoot);
      const maxX = minX + size;
      const maxZ = minZ + size;

      // Allocation-free: enumerate the 4 corners inline, emitting the low (and,
      // when an elevation range is present, the high) displacement per corner.
      const yLo = cfg.origin.y + (elevationRange ? elevationRange.min : 0);
      const yHi = elevationRange ? cfg.origin.y + elevationRange.max : 0;

      let pointCount = 0;
      for (let i = 0; i < 4; i++) {
        const cornerX = (i & 1) === 0 ? minX : maxX;
        const cornerZ = i < 2 ? minZ : maxZ;
        px[pointCount] = cornerX;
        py[pointCount] = yLo;
        pz[pointCount] = cornerZ;
        pointCount += 1;
        if (elevationRange) {
          px[pointCount] = cornerX;
          py[pointCount] = yHi;
          pz[pointCount] = cornerZ;
          pointCount += 1;
        }
      }

      boundingSphereFromPoints(px, py, pz, pointCount, cameraOrigin, out);
    },

    rootTiles(cameraOrigin: { x: number; y: number; z: number }, out: TileId[]): number {
      const camRootX = Math.floor((cameraOrigin.x - cfg.origin.x + halfRoot) / cfg.rootSize);
      const camRootY = Math.floor((cameraOrigin.z - cfg.origin.z + halfRoot) / cfg.rootSize);

      let index = 0;
      for (let dy = -rootGridRadius; dy <= rootGridRadius; dy++) {
        for (let dx = -rootGridRadius; dx <= rootGridRadius; dx++) {
          const root = out[index];
          root.space = 0;
          root.level = 0;
          root.x = camRootX + dx;
          root.y = camRootY + dy;
          index++;
        }
      }

      return index;
    },
  };
}
