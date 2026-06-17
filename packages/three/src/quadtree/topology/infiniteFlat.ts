import { createFlatProjection } from "../../projection/flat";
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

  return {
    spaceCount: 1,
    maxRootCount: rootWidth * rootWidth,
    projection: createFlatProjection(),

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

      const centerX = minX + 0.5 * size;
      const centerZ = minZ + 0.5 * size;
      const centerY =
        cfg.origin.y + (elevationRange ? (elevationRange.min + elevationRange.max) * 0.5 : 0);

      out.cx = centerX - cameraOrigin.x;
      out.cy = centerY - cameraOrigin.y;
      out.cz = centerZ - cameraOrigin.z;

      const halfDiag = 0.7071067811865476 * size;
      const vertExtent = elevationRange
        ? Math.max(Math.abs(elevationRange.min), Math.abs(elevationRange.max))
        : 0;
      out.r = halfDiag + vertExtent;
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
