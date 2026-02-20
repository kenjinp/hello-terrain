import { type SpatialIndex } from "../quadtree/leafIndex";
import { lookupSpatialIndexRaw } from "../quadtree/spatialIndex";
import { U32_EMPTY, type LeafSet } from "../quadtree";
import type { TileHit } from "./types";

export interface WorldToTileOptions {
  worldX: number;
  worldZ: number;
  leafSet: LeafSet;
  leafIndex: SpatialIndex;
  rootOrigin: { x: number; z: number };
  rootSize: number;
  innerTileSegments: number;
  maxLevel: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function worldToTile(options: WorldToTileOptions): TileHit | null {
  const {
    worldX,
    worldZ,
    leafSet,
    leafIndex,
    rootOrigin,
    rootSize,
    innerTileSegments,
    maxLevel,
  } = options;

  if (leafSet.count === 0 || rootSize <= 0 || innerTileSegments <= 0) return null;

  const halfRoot = rootSize * 0.5;
  const highestLevel = Math.max(0, maxLevel | 0);
  const edgeVertexCount = innerTileSegments + 3;

  for (let level = highestLevel; level >= 0; level -= 1) {
    const levelScale = 1 << level;
    const tileSize = rootSize / levelScale;
    const tileX = Math.floor((worldX - rootOrigin.x + halfRoot) / tileSize);
    const tileY = Math.floor((worldZ - rootOrigin.z + halfRoot) / tileSize);
    const leafIndexValue = lookupSpatialIndexRaw(leafIndex, 0, level, tileX, tileY);

    if (leafIndexValue === U32_EMPTY || leafIndexValue >= leafSet.count) continue;

    const minX = rootOrigin.x + tileX * tileSize - halfRoot;
    const minZ = rootOrigin.z + tileY * tileSize - halfRoot;
    const tileLocalU = clamp((worldX - minX) / tileSize, 0, 1);
    const tileLocalV = clamp((worldZ - minZ) / tileSize, 0, 1);

    // Terrain vertex data uses a 1-texel border for skirts.
    const texelX = clamp(
      Math.floor(tileLocalU * innerTileSegments + 1),
      0,
      edgeVertexCount - 1,
    );
    const texelY = clamp(
      Math.floor(tileLocalV * innerTileSegments + 1),
      0,
      edgeVertexCount - 1,
    );

    return {
      leafIndex: leafIndexValue,
      tileLocalU,
      tileLocalV,
      texelX,
      texelY,
    };
  }

  return null;
}
