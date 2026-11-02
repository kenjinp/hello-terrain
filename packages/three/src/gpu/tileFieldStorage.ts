import {
  ClampToEdgeWrapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
  UnsignedIntType,
} from "three";
import {
  float,
  int,
  ivec2,
  ivec3,
  storageTexture,
  texture,
  textureLoad,
  textureStore,
  uvec2,
  uvec4,
  vec2,
} from "three/tsl";
import type { Node, WebGPURenderer } from "three/webgpu";
import { StorageArrayTexture, StorageTexture } from "three/webgpu";

export type TileFieldStorageBackendType = "array-texture" | "atlas" | "texture-3d";
export type TileFieldStorageFormat = "rgba16float" | "rgba32float" | "r32uint" | "rgba8unorm";

export type TileFieldStorageOptions = {
  backend?: TileFieldStorageBackendType;
  filter?: "nearest" | "linear";
  format?: TileFieldStorageFormat;
};

export interface TileFieldStorage {
  readonly backendType: TileFieldStorageBackendType;
  readonly edgeVertexCount: number;
  readonly tileCount: number;
  readonly texture: StorageArrayTexture | StorageTexture;
  uv(ix: Node, iy: Node, tileIndex: Node): Node;
  texel(ix: Node, iy: Node, tileIndex: Node): Node;
  /** Float fields only. Integer fields must use loadTileField (no filtering). */
  sample(u: Node, v: Node, tileIndex: Node): Node;
  resize(width: number, height: number, tileCount: number): void;
}

type BackendOptions = Required<Pick<TileFieldStorageOptions, "format" | "filter">>;

function configureStorageTexture(
  tex: StorageArrayTexture | StorageTexture,
  options: BackendOptions,
) {
  const { format, filter } = options;
  if (format === "r32uint" && filter !== "nearest") {
    throw new Error("r32uint tile fields require nearest filtering; read with loadTileField");
  }
  tex.format = format === "r32uint" ? RedFormat : RGBAFormat;
  switch (format) {
    case "rgba16float":
      tex.type = HalfFloatType;
      break;
    case "rgba32float":
      tex.type = FloatType;
      break;
    case "r32uint":
      tex.type = UnsignedIntType;
      break;
    case "rgba8unorm":
      tex.type = UnsignedByteType;
      break;
  }
  tex.magFilter = tex.minFilter = filter === "linear" ? LinearFilter : NearestFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
}

function assertFilterable(format: TileFieldStorageFormat) {
  if (format === "r32uint") {
    throw new Error("r32uint tile fields must be read with loadTileField, not sample");
  }
}

export function ArrayTextureBackend(
  edgeVertexCount: number,
  tileCount: number,
  options: BackendOptions,
): TileFieldStorage {
  let currentEdgeVertexCount = edgeVertexCount;
  let currentTileCount = tileCount;
  const tex = new StorageArrayTexture(edgeVertexCount, edgeVertexCount, tileCount);
  tex.name = "tileField";
  configureStorageTexture(tex, options);
  return {
    backendType: "array-texture",
    get edgeVertexCount() {
      return currentEdgeVertexCount;
    },
    get tileCount() {
      return currentTileCount;
    },
    texture: tex,
    uv(ix, iy) {
      return vec2(ix.toFloat(), iy.toFloat());
    },
    texel(ix, iy, tileIndex) {
      return ivec3(ix, iy, tileIndex);
    },
    sample(u, v, tileIndex) {
      assertFilterable(options.format);
      return texture(tex, vec2(u, v)).depth(int(tileIndex));
    },
    resize(width, height, nextTileCount) {
      currentEdgeVertexCount = width;
      currentTileCount = nextTileCount;
      tex.setSize(width, height, nextTileCount);
      tex.needsUpdate = true;
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
  return {
    atlasX: tile.mod(tilesPerRowNode).mul(edge).add(int(ix)),
    atlasY: tile.div(tilesPerRowNode).mul(edge).add(int(iy)),
  };
}

export function AtlasBackend(
  edgeVertexCount: number,
  tileCount: number,
  options: BackendOptions,
): TileFieldStorage {
  let currentEdgeVertexCount = edgeVertexCount;
  let currentTileCount = tileCount;
  let tilesPerRow = Math.max(1, Math.ceil(Math.sqrt(tileCount)));
  const atlasSize = tilesPerRow * edgeVertexCount;
  const tex = new StorageTexture(atlasSize, atlasSize);
  tex.name = "tileFieldAtlas";
  configureStorageTexture(tex, options);
  return {
    backendType: "atlas",
    get edgeVertexCount() {
      return currentEdgeVertexCount;
    },
    get tileCount() {
      return currentTileCount;
    },
    texture: tex,
    uv(ix, iy, tileIndex) {
      const { atlasX, atlasY } = atlasCoord(tilesPerRow, currentEdgeVertexCount, ix, iy, tileIndex);
      const size = float(tilesPerRow * currentEdgeVertexCount);
      return vec2(atlasX.toFloat().add(0.5).div(size), atlasY.toFloat().add(0.5).div(size));
    },
    texel(ix, iy, tileIndex) {
      const { atlasX, atlasY } = atlasCoord(tilesPerRow, currentEdgeVertexCount, ix, iy, tileIndex);
      return ivec2(atlasX, atlasY);
    },
    sample(u, v, tileIndex) {
      assertFilterable(options.format);
      const tile = int(tileIndex);
      const rowSize = int(tilesPerRow);
      const invRowSize = float(1 / tilesPerRow);
      return texture(
        tex,
        vec2(
          tile.mod(rowSize).toFloat().add(u).mul(invRowSize),
          tile.div(rowSize).toFloat().add(v).mul(invRowSize),
        ),
      );
    },
    resize(width, _height, nextTileCount) {
      currentEdgeVertexCount = width;
      currentTileCount = nextTileCount;
      tilesPerRow = Math.max(1, Math.ceil(Math.sqrt(nextTileCount)));
      const nextAtlasSize = tilesPerRow * width;
      tex.setSize(nextAtlasSize, nextAtlasSize, 1);
      tex.needsUpdate = true;
    },
  };
}

/** Selects an array when capacity fits the device, otherwise a square tile atlas. */
export function createTileFieldStorage(
  edgeVertexCount: number,
  tileCount: number,
  renderer?: WebGPURenderer,
  options: TileFieldStorageOptions = {},
): TileFieldStorage {
  const format = options.format ?? "rgba16float";
  const filter = options.filter ?? (format === "r32uint" ? "nearest" : "linear");
  const device = (
    renderer as
      | (WebGPURenderer & {
          backend?: { device?: { limits?: { maxTextureArrayLayers?: number } } };
        })
      | undefined
  )?.backend?.device;
  const backend =
    options.backend ??
    (tileCount > (device?.limits?.maxTextureArrayLayers ?? 256) ? "atlas" : "array-texture");
  if (backend === "atlas") return AtlasBackend(edgeVertexCount, tileCount, { format, filter });
  const storage = ArrayTextureBackend(edgeVertexCount, tileCount, { format, filter });
  // The existing "texture-3d" selection uses array layers, not a 3D texture.
  return backend === "texture-3d" ? { ...storage, backendType: backend } : storage;
}

/** Integer fields accept a scalar uint; WGSL textureStore requires a vec4<u32>. */
export function storeTileField(
  storage: TileFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
  value: Node,
): Node {
  const texelValue = storage.texture.type === UnsignedIntType ? uvec4(value, 0, 0, 0) : value;
  if (storage.backendType !== "atlas") {
    // Set depth before stacking. textureStore() stacks immediately; a later
    // .depth() affects only a clone, and a uvec3 coordinate loses its layer.
    return storageTexture(storage.texture, uvec2(int(ix), int(iy)), texelValue)
      .depth(int(tileIndex))
      .toStack();
  }
  return textureStore(storage.texture, storage.texel(ix, iy, tileIndex), texelValue);
}

/** Exact mip-zero load, including in divergent fragment control flow. */
export function loadTileField(
  storage: TileFieldStorage,
  ix: Node,
  iy: Node,
  tileIndex: Node,
): Node {
  if (storage.backendType !== "atlas") {
    return textureLoad(storage.texture, ivec2(int(ix), int(iy)), int(0)).depth(int(tileIndex));
  }
  return textureLoad(storage.texture, storage.texel(ix, iy, tileIndex), int(0));
}
