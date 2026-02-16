import { type Surface, type TileBounds, type TileId } from "../types";

export type CubeSphereSurfaceConfig = {
  radius: number;
  maxHeight?: number;
};

/**
 * Placeholder cube-sphere surface.
 *
 * This exists to localize future planet work behind the `Surface` interface.
 * Topology remapping across face edges is intentionally TODO.
 */
export function createCubeSphereSurface(_cfg: CubeSphereSurfaceConfig): Surface {
  return {
    spaceCount: 6,
    maxRootCount: 6,

    neighborSameLevel(_tile: TileId, _dir: 0 | 1 | 2 | 3, _out: TileId): boolean {
      // TODO: implement face-edge remaps.
      return false;
    },

    tileBounds(_tile: TileId, _cameraOrigin: { x: number; y: number; z: number }, out: TileBounds): void {
      // TODO: implement conservative sphere bounds per tile.
      // For now, emit a huge radius so criteria will (safely) refine aggressively if used.
      out.cx = 0;
      out.cy = 0;
      out.cz = 0;
      out.r = Number.MAX_VALUE;
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

