import {
  ClampToEdgeWrapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
} from "three";
import {
  float,
  int,
  ivec2,
  ivec3,
  textureLoad,
  textureStore,
  uvec3,
  vec2,
  vec4,
} from "three/tsl";
import type { Node, WebGPURenderer } from "three/webgpu";
import { StorageArrayTexture, StorageTexture } from "three/webgpu";

export type TerrainFieldStorageBackendType =
  | "array-texture"
  | "atlas"
  | "texture-3d";
export type TerrainFieldStorageFormat = "rgba16float" | "rgba32float";

export type TerrainFieldStorageOptions = {
  backend?: TerrainFieldStorageBackendType;
  filter?: "nearest" | "linear";
  format?: TerrainFieldStorageFormat;
};

export interface TerrainFieldStorage {
  readonly backendType: TerrainFieldStorageBackendType;
  readonly edgeVertexCount: number;
  readonly tileCount: number;
  readonly texture: StorageArrayTexture | StorageTexture;
  uv(ix: Node, iy: Node, tileIndex: Node): Node;
  texel(ix: Node, iy: Node, tileIndex: Node): Node;
  resize(width: number, height: number, tileCount: number): void;
}

type TextureType = typeof HalfFloatType | typeof FloatType;
type TextureFilter = typeof LinearFilter | typeof NearestFilter;

function resolveType(format: TerrainFieldStorageFormat): TextureType {
  return format === "rgba16float" ? HalfFloatType : FloatType;
}

function resolveFilter(mode: "nearest" | "linear"): TextureFilter {
  return mode === "linear" ? LinearFilter : NearestFilter;
}

function configureStorageTexture(
  texture: StorageArrayTexture | StorageTexture,
  format: TerrainFieldStorageFormat,
  filter: "nearest" | "linear",
) {
  texture.format = RGBAFormat;
  texture.type = resolveType(format);
  texture.magFilter = resolveFilter(filter);
  texture.minFilter = resolveFilter(filter);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

export function ArrayTextureBackend(
  edgeVertexCount: number,
  tileCount: number,
  options: Required<Pick<TerrainFieldStorageOptions, "format" | "filter">>,
): TerrainFieldStorage {
  let currentEdgeVertexCount = edgeVertexCount;
  let currentTileCount = tileCount;
  const texture = new StorageArrayTexture(
    edgeVertexCount,
    edgeVertexCount,
    tileCount,
  );
  configureStorageTexture(texture, options.format, options.filter);

  return {
    backendType: "array-texture",
    get edgeVertexCount() {
      return currentEdgeVertexCount;
    },
    get tileCount() {
      return currentTileCount;
    },
    texture,
    uv(ix: Node, iy: Node, _tileIndex: Node): Node {
      return vec2(ix.toFloat(), iy.toFloat());
    },
    texel(ix: Node, iy: Node, tileIndex: Node): Node {
      return ivec3(ix, iy, tileIndex);
    },
    resize(width: number, height: number, nextTileCount: number): void {
      currentEdgeVertexCount = width;
      currentTileCount = nextTileCount;
      texture.setSize(width, height, nextTileCount);
      texture.needsUpdate = true;
    },
  };
}

function atlasCoord(
  tilesPerRow: number,
  edgeVertexCount: number,
  ix: Node,
  iy: Node,
  tileIndex: Node,
) {
  const tilesPerRowNode = int(tilesPerRow);
  const edge = int(edgeVertexCount);
  const tile = int(tileIndex);
  const col = tile.mod(tilesPerRowNode);
  const row = tile.div(tilesPerRowNode);
  const atlasX = col.mul(edge).add(int(ix));
  const atlasY = row.mul(edge).add(int(iy));
  return { atlasX, atlasY };
}

export function AtlasBackend(
  edgeVertexCount: number,
  tileCount: number,
  options: Required<Pick<TerrainFieldStorageOptions, "format" | "filter">>,
): TerrainFieldStorage {
  let currentEdgeVertexCount = edgeVertexCount;
  let currentTileCount = tileCount;
  let tilesPerRow = Math.max(1, Math.ceil(Math.sqrt(tileCount)));
  const atlasSize = tilesPerRow * edgeVertexCount;
  const texture = new StorageTexture(atlasSize, atlasSize);
  configureStorageTexture(texture, options.format, options.filter);

  return {
    backendType: "atlas",
    get edgeVertexCount() {
      return currentEdgeVertexCount;
    },
    get tileCount() {
      return currentTileCount;
    },
    texture,
    uv(ix: Node, iy: Node, tileIndex: Node): Node {
      const { atlasX, atlasY } = atlasCoord(
        tilesPerRow,
        currentEdgeVertexCount,
        ix,
        iy,
        tileIndex,
      );
      const currentAtlasSize = float(tilesPerRow * currentEdgeVertexCount);
      return vec2(
        atlasX.toFloat().add(0.5).div(currentAtlasSize),
        atlasY.toFloat().add(0.5).div(currentAtlasSize),
      );
    },
    texel(ix: Node, iy: Node, tileIndex: Node): Node {
      const { atlasX, atlasY } = atlasCoord(
        tilesPerRow,
        currentEdgeVertexCount,
        ix,
        iy,
        tileIndex,
      );
      return ivec2(atlasX, atlasY);
    },
    resize(width: number, height: number, nextTileCount: number): void {
      currentEdgeVertexCount = width;
      currentTileCount = nextTileCount;
      tilesPerRow = Math.max(1, Math.ceil(Math.sqrt(nextTileCount)));
      const nextAtlasSize = tilesPerRow * width;
      const image = texture.image as { width: number; height: number };
      image.width = nextAtlasSize;
      image.height = nextAtlasSize;
      texture.needsUpdate = true;
    },
  };
}

/**
 * Placeholder backend for future true 3D storage-texture support in Three.js.
 * We keep it present to preserve the backend API shape.
 */
export function Texture3DBackend(
  edgeVertexCount: number,
  tileCount: number,
  options: Required<Pick<TerrainFieldStorageOptions, "format" | "filter">>,
): TerrainFieldStorage {
  let currentEdgeVertexCount = edgeVertexCount;
  let currentTileCount = tileCount;
  // Temporary implementation: map to array-texture backend semantics.
  const texture = new StorageArrayTexture(
    edgeVertexCount,
    edgeVertexCount,
    tileCount,
  );
  configureStorageTexture(texture, options.format, options.filter);

  return {
    backendType: "texture-3d",
    get edgeVertexCount() {
      return currentEdgeVertexCount;
    },
    get tileCount() {
      return currentTileCount;
    },
    texture,
    uv(ix: Node, iy: Node, _tileIndex: Node): Node {
      return vec2(ix.toFloat(), iy.toFloat());
    },
    texel(ix: Node, iy: Node, tileIndex: Node): Node {
      return ivec3(ix, iy, tileIndex);
    },
    resize(width: number, height: number, nextTileCount: number): void {
      currentEdgeVertexCount = width;
      currentTileCount = nextTileCount;
      texture.setSize(width, height, nextTileCount);
      texture.needsUpdate = true;
    },
  };
}

type DeviceLimits = {
  maxTextureArrayLayers?: number;
};

function tryGetDeviceLimits(renderer: WebGPURenderer): DeviceLimits {
  const backend = renderer as WebGPURenderer & {
    backend?: {
      device?: {
        limits?: DeviceLimits;
      };
    };
  };
  return backend.backend?.device?.limits ?? {};
}

export function createTerrainFieldStorage(
  edgeVertexCount: number,
  tileCount: number,
  renderer?: WebGPURenderer,
  options: TerrainFieldStorageOptions = {},
): TerrainFieldStorage {
  const filter = options.filter ?? "nearest";
  const format = options.format ?? "rgba16float";
  const forcedBackend = options.backend;

  if (forcedBackend === "atlas") {
    return AtlasBackend(edgeVertexCount, tileCount, { filter, format });
  }
  if (forcedBackend === "texture-3d") {
    return Texture3DBackend(edgeVertexCount, tileCount, { filter, format });
  }
  if (forcedBackend === "array-texture") {
    return ArrayTextureBackend(edgeVertexCount, tileCount, { filter, format });
  }

  const DEFAULT_MAX_TEXTURE_ARRAY_LAYERS = 256;
  const maxLayers = renderer
    ? (tryGetDeviceLimits(renderer).maxTextureArrayLayers ??
      DEFAULT_MAX_TEXTURE_ARRAY_LAYERS)
    : DEFAULT_MAX_TEXTURE_ARRAY_LAYERS;
  if (tileCount > maxLayers) {
    return AtlasBackend(edgeVertexCount, tileCount, { filter, format });
  }

  return ArrayTextureBackend(edgeVertexCount, tileCount, { filter, format });
}

export function storeTerrainField(
  storage: TerrainFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
  value: Node,
): Node {
  if (
    storage.backendType === "array-texture" ||
    storage.backendType === "texture-3d"
  ) {
    return textureStore(
      storage.texture,
      uvec3(int(ix), int(iy), int(tileIndex)),
      value,
    );
  }
  return textureStore(storage.texture, storage.texel(ix, iy, tileIndex), value);
}

export function loadTerrainField(
  storage: TerrainFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
): Node {
  if (
    storage.backendType === "array-texture" ||
    storage.backendType === "texture-3d"
  ) {
    return textureLoad(storage.texture, ivec2(int(ix), int(iy)), int(0)).depth(
      int(tileIndex),
    );
  }
  return textureLoad(storage.texture, storage.texel(ix, iy, tileIndex), int(0));
}

export function loadTerrainFieldElevation(
  storage: TerrainFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
): Node {
  return loadTerrainField(storage, ix, iy, tileIndex).r;
}

export function loadTerrainFieldNormal(
  storage: TerrainFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
): Node {
  const sample = loadTerrainField(storage, ix, iy, tileIndex);
  return vec2(sample.g, sample.b);
}

export function packTerrainFieldSample(
  height: Node,
  normalXZ: Node,
  extra: Node = float(0),
): Node {
  return vec4(height, normalXZ.x, normalXZ.y, extra);
}
