import type { WebGPURenderer } from "three/webgpu";
import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
import type { TerrainReadbackCache, TerrainReadbackResult } from "./types";

type MaybeTextureReader = WebGPURenderer & {
  readStorageTextureAsync?: (
    texture: unknown,
  ) => Promise<ArrayBufferView | ArrayBuffer>;
  readTextureAsync?: (
    texture: unknown,
  ) => Promise<ArrayBufferView | ArrayBuffer>;
};

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function createReadbackCache(
  edgeVertexCount: number,
  tileCount: number,
  previous?: TerrainReadbackCache,
): TerrainReadbackCache {
  const totalFloats = edgeVertexCount * edgeVertexCount * tileCount * 4;
  if (
    previous &&
    previous.edgeVertexCount === edgeVertexCount &&
    previous.tileCount === tileCount &&
    previous.data.length === totalFloats
  ) {
    return previous;
  }

  return {
    edgeVertexCount,
    tileCount,
    channels: 4,
    data: new Float32Array(totalFloats),
  };
}

function asFloat32Data(
  payload: ArrayBuffer | ArrayBufferView,
): Float32Array | null {
  if (payload instanceof Float32Array) return payload;
  if (payload instanceof Uint16Array) {
    // Half-float decode is not available without explicit conversion.
    return null;
  }
  if (ArrayBuffer.isView(payload)) {
    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      Math.floor(payload.byteLength / 4),
    );
  }
  if (payload instanceof ArrayBuffer) {
    return new Float32Array(payload);
  }
  return null;
}

function repackAtlasToTiles(
  atlasData: Float32Array,
  cache: TerrainReadbackCache,
): void {
  const edge = cache.edgeVertexCount;
  const tilesPerRow = Math.max(1, Math.ceil(Math.sqrt(cache.tileCount)));
  const atlasEdge = tilesPerRow * edge;

  for (let tile = 0; tile < cache.tileCount; tile += 1) {
    const tileCol = tile % tilesPerRow;
    const tileRow = Math.floor(tile / tilesPerRow);
    const tileBase = tile * edge * edge * 4;
    const atlasTileStartX = tileCol * edge;
    const atlasTileStartY = tileRow * edge;

    for (let y = 0; y < edge; y += 1) {
      for (let x = 0; x < edge; x += 1) {
        const src =
          ((atlasTileStartY + y) * atlasEdge + (atlasTileStartX + x)) * 4;
        const dst = tileBase + (y * edge + x) * 4;
        cache.data[dst] = atlasData[src] ?? 0;
        cache.data[dst + 1] = atlasData[src + 1] ?? 0;
        cache.data[dst + 2] = atlasData[src + 2] ?? 0;
        cache.data[dst + 3] = atlasData[src + 3] ?? 0;
      }
    }
  }
}

function copyArrayTextureData(
  source: Float32Array,
  cache: TerrainReadbackCache,
): void {
  const count = Math.min(source.length, cache.data.length);
  cache.data.fill(0);
  cache.data.set(source.subarray(0, count), 0);
}

/**
 * Attempts to read TerrainFieldStorage texture data back to CPU.
 *
 * If the renderer does not expose a supported readback helper, this returns a
 * cache with `ready: false` and leaves previously cached data intact.
 */
export async function readbackTerrainField(
  renderer: WebGPURenderer | undefined,
  terrainFieldStorage: TerrainFieldStorage,
  previous?: TerrainReadbackCache,
): Promise<TerrainReadbackResult> {
  const cache = createReadbackCache(
    terrainFieldStorage.edgeVertexCount,
    terrainFieldStorage.tileCount,
    previous,
  );

  if (!renderer) return { cache, ready: false };

  const maybeReader = renderer as MaybeTextureReader;
  const readFn =
    maybeReader.readStorageTextureAsync ?? maybeReader.readTextureAsync;

  if (!readFn) {
    return { cache, ready: false };
  }

  const payload = await readFn(terrainFieldStorage.texture);
  const floatData = asFloat32Data(payload);
  if (!floatData) return { cache, ready: false };

  if (terrainFieldStorage.backendType === "atlas") {
    repackAtlasToTiles(floatData, cache);
  } else {
    copyArrayTextureData(floatData, cache);
  }

  // Keep this branch explicit for future per-tile partial readback support.
  if (terrainFieldStorage.backendType === "array-texture") {
    alignTo(terrainFieldStorage.edgeVertexCount * 4 * 4, 256);
  }

  return { cache, ready: true };
}
