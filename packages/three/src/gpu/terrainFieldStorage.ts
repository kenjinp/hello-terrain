import { float, int, max, vec3, vec4 } from "three/tsl";
import type { Node, StorageBufferNode, WebGPURenderer } from "three/webgpu";
import {
  createTileFieldStorage,
  loadTileField,
  storeTileField,
  type TileFieldStorage,
  type TileFieldStorageBackendType,
} from "./tileFieldStorage";

/** Existing terrain-field API; allocation and addressing are shared with other fields. */
export type TerrainFieldStorage = TileFieldStorage;
export type TerrainFieldStorageBackendType = TileFieldStorageBackendType;
export type TerrainFieldStorageFormat = "rgba16float" | "rgba32float";
export type TerrainFieldStorageOptions = {
  backend?: TerrainFieldStorageBackendType;
  filter?: "nearest" | "linear";
  format?: TerrainFieldStorageFormat;
};

export function createTerrainFieldStorage(
  edgeVertexCount: number,
  tileCount: number,
  renderer?: WebGPURenderer,
  options: TerrainFieldStorageOptions = {},
): TerrainFieldStorage {
  return createTileFieldStorage(edgeVertexCount, tileCount, renderer, options);
}

export function storeTerrainField(
  storage: TerrainFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
  value: Node,
): Node {
  return storeTileField(storage, ix, iy, tileIndex, value);
}

export function loadTerrainField(
  storage: TerrainFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
): Node {
  return loadTileField(storage, ix, iy, tileIndex);
}

/** Floats stored per tile in the tile bounds GPU buffer. */
export const TILE_BOUNDS_FLOATS_PER_TILE = 4;
export const TILE_BOUNDS_LOD_MIN_OFFSET = 0;
export const TILE_BOUNDS_LOD_MAX_OFFSET = 1;
export const TILE_BOUNDS_PACK_MIN_OFFSET = 2;
export const TILE_BOUNDS_PACK_MAX_OFFSET = 3;

/** Minimum elevation span (meters) when normalizing flat tiles. */
export const TERRAIN_FIELD_PACK_EPSILON = 1e-4;

export function loadTerrainFieldElevation(
  storage: TileFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
): Node {
  return loadTileField(storage, ix, iy, tileIndex).r;
}

export function loadTerrainFieldNormal(
  storage: TileFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
): Node {
  const raw = loadTileField(storage, ix, iy, tileIndex);
  return vec3(raw.g, raw.b, raw.a);
}

/**
 * UV-based filtered sample. `u, v` are in [0, 1] tile-local space.
 * Respects the filter mode (nearest / linear) set on the storage.
 */
export function sampleTerrainField(
  storage: TileFieldStorage,
  u: Node,
  v: Node,
  tileIndex: Node,
): Node {
  return storage.sample(u, v, tileIndex);
}

export function sampleTerrainFieldElevation(
  storage: TileFieldStorage,
  u: Node,
  v: Node,
  tileIndex: Node,
): Node {
  return sampleTerrainField(storage, u, v, tileIndex).r;
}

/**
 * Pack a terrain field sample into RGBA: `[height, Nx, Ny, Nz]` where
 * `(Nx, Ny, Nz)` is the unit world-space surface normal. Storing the full
 * world normal (rather than a face-local tangent pair) keeps shading
 * continuous across cube-face seams, since adjacent faces no longer rotate the
 * normal through their own parametric tangent frame.
 */
export function packTerrainFieldSample(height: Node, normal: Node): Node {
  return vec4(height, normal.x, normal.y, normal.z);
}

export function loadTilePackBounds(boundsNode: StorageBufferNode, tileIndex: Node) {
  const base = int(tileIndex).mul(int(TILE_BOUNDS_FLOATS_PER_TILE));
  return {
    packMin: boundsNode.element(base.add(int(TILE_BOUNDS_PACK_MIN_OFFSET))),
    packMax: boundsNode.element(base.add(int(TILE_BOUNDS_PACK_MAX_OFFSET))),
  };
}

/** Normalize elevation into [0, 1] for rgba16float terrain-field storage. */
export function packNormalizedTerrainFieldSample(
  height: Node,
  normal: Node,
  packMin: Node,
  packMax: Node,
): Node {
  const span = max(packMax.sub(packMin), float(TERRAIN_FIELD_PACK_EPSILON));
  const normalized = height.sub(packMin).div(span);
  return vec4(normalized, normal.x, normal.y, normal.z);
}

/** Restore absolute elevation (meters) from a normalized terrain-field sample. */
export function denormalizeTerrainFieldElevation(
  normalized: Node,
  packMin: Node,
  packMax: Node,
): Node {
  const span = max(packMax.sub(packMin), float(TERRAIN_FIELD_PACK_EPSILON));
  return packMin.add(normalized.mul(span));
}
