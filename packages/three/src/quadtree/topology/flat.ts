import { Dir, type TileBounds, type TileId, type Topology } from "../types";

export type FlatTopologyConfig = {
  /**
   * World-space size of the root tile edge.
   * The root tile covers [-rootSize/2, +rootSize/2] around origin in X/Z.
   */
  rootSize: number;
  origin: { x: number; y: number; z: number };
  /** optional conservative vertical extent, included in bounds radius */
  maxHeight?: number;
};

export function createFlatTopology(cfg: FlatTopologyConfig): Topology {
  const halfRoot = 0.5 * cfg.rootSize;
  const maxHeight = cfg.maxHeight ?? 0;

  const topology: Topology = {
    spaceCount: 1,
    maxRootCount: 1,

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
      out.x = nx;
      out.y = ny;
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

    rootTiles(_cameraOrigin: { x: number; y: number; z: number }, out: TileId[]): number {
      const root = out[0];
      root.space = 0;
      root.level = 0;
      root.x = 0;
      root.y = 0;
      return 1;
    },
  };

  return topology;
}

