import { Dir, type Surface, type TileBounds, type TileId } from "../types";

export type FlatSurfaceConfig = {
  /**
   * World-space size of the root tile edge.
   * The root tile covers [-rootSize/2, +rootSize/2] around origin in X/Z.
   */
  rootSize: number;
  origin: { x: number; y: number; z: number };
  /** optional conservative vertical extent, included in bounds radius */
  maxHeight?: number;
};

export function createFlatSurface(cfg: FlatSurfaceConfig): Surface {
  const halfRoot = 0.5 * cfg.rootSize;
  const maxHeight = cfg.maxHeight ?? 0;

  const surface: Surface = {
    spaceCount: 1,

    neighborSameLevel(tile: TileId, dir: Dir, out: TileId): boolean {
      const level = tile.level;
      const x = tile.x;
      const y = tile.y;

      let nx = x;
      let ny = y;

      switch (dir) {
        case Dir.LEFT:
          nx = x - 1;
          break;
        case Dir.RIGHT:
          nx = x + 1;
          break;
        case Dir.TOP:
          ny = y - 1;
          break;
        case Dir.BOTTOM:
          ny = y + 1;
          break;
      }

      if (nx < 0 || ny < 0) return false;
      const maxCoord = (1 << level) - 1;
      if (nx > maxCoord || ny > maxCoord) return false;

      out.space = 0;
      out.level = level;
      out.x = nx >>> 0;
      out.y = ny >>> 0;
      return true;
    },

    tileBounds(tile: TileId, cameraOrigin: { x: number; y: number; z: number }, out: TileBounds): void {
      const level = tile.level;
      const scale = 1 / (1 << level);
      const size = cfg.rootSize * scale;

      const minX = cfg.origin.x + (tile.x * size - halfRoot);
      const minZ = cfg.origin.z + (tile.y * size - halfRoot);

      const centerX = minX + 0.5 * size;
      const centerY = cfg.origin.y;
      const centerZ = minZ + 0.5 * size;

      out.cx = centerX - cameraOrigin.x;
      out.cy = centerY - cameraOrigin.y;
      out.cz = centerZ - cameraOrigin.z;

      // Conservative: half-diagonal + vertical extent.
      out.r = 0.7071067811865476 * size + maxHeight;
    },
  };

  return surface;
}

