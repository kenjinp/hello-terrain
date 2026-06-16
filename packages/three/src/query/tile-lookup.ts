import type { SpatialIndex } from "../quadtree";
import { U32_EMPTY, directionToFace, directionToFaceUV } from "../quadtree";
import { lookupSpatialIndexRaw } from "../quadtree/spatialIndex";
import { sphereTileArcLength } from "../gpu/tile";

/**
 * Coarse-to-fine CPU tile lookups against a snapshot spatial index.
 *
 * Mirrors: the TSL lookups `createTileIndexFromWorldPosition` /
 * `createTileIndexFromDirection` in `query/gpuSpatialIndex.ts`. Keep the
 * coordinate math in sync.
 */

export type TileLookupResult = {
  found: boolean;
  leafIndex: number;
  space: number;
  level: number;
  tileX: number;
  tileY: number;
  tileSize: number;
  localU: number;
  localV: number;
};

/** Shared miss sentinel; never mutated. */
export const MISSED_LOOKUP: TileLookupResult = Object.freeze({
  found: false,
  leafIndex: -1,
  space: -1,
  level: -1,
  tileX: -1,
  tileY: -1,
  tileSize: 0,
  localU: 0,
  localV: 0,
});

export interface TileLookupConfig {
  rootSize: number;
  originX: number;
  originZ: number;
  maxLevel: number;
  /** Representative surface radius (used to scale curved tile arc length). */
  radius: number;
}

/** Flat lookup keyed on world XZ; searches space 0 from finest to coarsest. */
export function lookupTile(
  index: SpatialIndex,
  config: TileLookupConfig,
  worldX: number,
  worldZ: number,
): TileLookupResult {
  const halfRoot = config.rootSize * 0.5;
  for (let level = config.maxLevel; level >= 0; level -= 1) {
    const scale = 2 ** level;
    const tileSize = config.rootSize / scale;
    const tileX = Math.floor((worldX - config.originX + halfRoot) / tileSize);
    const tileY = Math.floor((worldZ - config.originZ + halfRoot) / tileSize);
    const leafIndex = lookupSpatialIndexRaw(index, 0, level, tileX, tileY);
    if (leafIndex !== U32_EMPTY) {
      const tileMinX = config.originX + tileX * tileSize - halfRoot;
      const tileMinZ = config.originZ + tileY * tileSize - halfRoot;
      return {
        found: true,
        leafIndex,
        space: 0,
        level,
        tileX,
        tileY,
        tileSize,
        localU: (worldX - tileMinX) / tileSize,
        localV: (worldZ - tileMinZ) / tileSize,
      };
    }
  }
  return MISSED_LOOKUP;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Coarse-to-fine tile lookup on a cube-sphere face. */
export function lookupTileByFaceUV(
  index: SpatialIndex,
  config: TileLookupConfig,
  face: number,
  u: number,
  v: number,
): TileLookupResult {
  for (let level = config.maxLevel; level >= 0; level -= 1) {
    const n = 2 ** level;
    let tileX = Math.floor(u * n);
    let tileY = Math.floor(v * n);
    if (tileX < 0) tileX = 0;
    else if (tileX > n - 1) tileX = n - 1;
    if (tileY < 0) tileY = 0;
    else if (tileY > n - 1) tileY = n - 1;
    const leafIndex = lookupSpatialIndexRaw(index, face, level, tileX, tileY);
    if (leafIndex !== U32_EMPTY) {
      // Arc length of a tile edge on the sphere, used to scale gradients.
      const tileSize = sphereTileArcLength(config.radius, n);
      return {
        found: true,
        leafIndex,
        space: face,
        level,
        tileX,
        tileY,
        tileSize,
        localU: clamp01(u * n - tileX),
        localV: clamp01(v * n - tileY),
      };
    }
  }
  return MISSED_LOOKUP;
}

/**
 * Tile lookup from a (possibly unnormalized) direction from the planet
 * center. `dirScratch`/`uvScratch` are caller-owned to keep lookups
 * allocation-free (the terrain may have many instances; no module scratch).
 */
export function lookupTileForDirection(
  index: SpatialIndex,
  config: TileLookupConfig,
  dx: number,
  dy: number,
  dz: number,
  dirScratch: [number, number, number],
  uvScratch: [number, number],
): TileLookupResult {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return MISSED_LOOKUP;
  dirScratch[0] = dx / len;
  dirScratch[1] = dy / len;
  dirScratch[2] = dz / len;
  const face = directionToFace(dirScratch);
  directionToFaceUV(face, dirScratch, uvScratch);
  return lookupTileByFaceUV(index, config, face, uvScratch[0], uvScratch[1]);
}
