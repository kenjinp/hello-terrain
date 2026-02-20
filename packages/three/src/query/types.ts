import type { Node, StorageBufferNode } from "three/webgpu";
import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
import type { TerrainUniformsContext } from "../types";
import type { ElevationCallback } from "../tsl/elevation";

export interface TerrainNormal {
  x: number;
  y: number;
  z: number;
}

export interface TerrainSample {
  elevation: number;
  normal: TerrainNormal;
}

export interface TileHit {
  leafIndex: number;
  tileLocalU: number;
  tileLocalV: number;
  texelX: number;
  texelY: number;
}

export interface TerrainQuery {
  getElevation(worldX: number, worldZ: number): number | null;
  getNormal(worldX: number, worldZ: number): TerrainNormal | null;
  sample(worldX: number, worldZ: number): TerrainSample | null;
  sampleAtRootUV(u: number, v: number): TerrainSample | null;
  sampleBatch(
    positions: Float32Array,
    outElevations: Float32Array,
    outNormals?: Float32Array,
    outValid?: Uint8Array,
  ): number;
}

export interface TerrainReadbackCache {
  readonly edgeVertexCount: number;
  readonly tileCount: number;
  readonly channels: 4;
  readonly data: Float32Array;
}

export interface TerrainReadbackResult {
  readonly cache: TerrainReadbackCache;
  readonly ready: boolean;
}

export interface GpuSpatialIndexData {
  readonly count: number;
  readonly size: number;
  readonly mask: number;
  readonly stampGen: number;
  readonly stamp: Uint32Array;
  readonly keysSpace: Uint32Array;
  readonly keysLevel: Uint32Array;
  readonly keysX: Uint32Array;
  readonly keysY: Uint32Array;
  readonly values: Uint32Array;
}

export interface GpuSpatialIndexContext {
  readonly data: GpuSpatialIndexData;
  readonly buffer: StorageBufferNode;
  readonly maxLevel: number;
}

export interface TerrainSampler {
  sampleElevation: (worldX: Node, worldZ: Node) => Node;
  sampleNormal: (worldX: Node, worldZ: Node) => Node;
  sampleTerrain: (worldX: Node, worldZ: Node) => Node;
  sampleValidity: (worldX: Node, worldZ: Node) => Node;
  evaluateElevation: (worldX: Node, worldZ: Node) => Node;
  evaluateNormal: (worldX: Node, worldZ: Node, epsilon?: Node) => Node;
}

export interface CreateTerrainSamplerParams {
  terrainFieldStorage: TerrainFieldStorage;
  spatialIndex: GpuSpatialIndexContext;
  uniforms: TerrainUniformsContext;
  elevationCallback: ElevationCallback;
}

export interface GpuBatchQueryResult {
  elevations: Float32Array;
  normals: Float32Array;
  valid: Uint8Array;
}
