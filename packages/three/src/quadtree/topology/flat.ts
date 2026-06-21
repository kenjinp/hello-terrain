import { createFlatProjection } from "../../projection/flat";
import { boundingSphereFromPoints } from "../bounds";
import { Dir, type ElevationRangeOut, type TileBounds, type TileId, type Topology } from "../types";

export type FlatTopologyConfig = {
  /**
   * World-space size of the root tile edge.
   * The root tile covers [-rootSize/2, +rootSize/2] around origin in X/Z.
   */
  rootSize: number;
  origin: { x: number; y: number; z: number };
};

export function createFlatTopology(cfg: FlatTopologyConfig): Topology {
  const halfRoot = 0.5 * cfg.rootSize;
  // Scratch for the 4 tile corners × {min, max} elevation samples.
  const px = new Float64Array(8);
  const py = new Float64Array(8);
  const pz = new Float64Array(8);

  const topology: Topology = {
    spaceCount: 1,
    maxRootCount: 1,
    projection: createFlatProjection(),

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
