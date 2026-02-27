import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
import type { ElevationCallback } from "../tsl/elevation";
import type { TerrainUniformsContext } from "../types";
import type { Ray, Vector3 } from "three";
import type { Node, StorageBufferAttribute, StorageBufferNode, UniformNode } from "three/webgpu";

export interface GpuSpatialIndexContext {
  data: Uint32Array<ArrayBuffer>;
  size: number;
  mask: number;
  stampGen: UniformNode<number>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
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

export interface TerrainSample {
  elevation: number;
  normal: Vector3;
  valid: boolean;
}

export interface TerrainSampleBatch {
  elevations: Float32Array;
  normals: Float32Array;
  valid: Uint8Array;
  generation: number;
}

export interface TerrainTile {
  level: number;
  x: number;
  y: number;
  index: number;
}

export interface TerrainQuery {
  getElevation(worldX: number, worldZ: number): number;
  getNormal(worldX: number, worldZ: number): Vector3;
  getTile(worldX: number, worldZ: number): TerrainTile | null;
  sampleTerrain(worldX: number, worldZ: number): TerrainSample;
  sampleTerrainBatch(positions: Float32Array): TerrainSampleBatch;
  readonly generation: number;
}

export interface RaycastOptions {
  maxSteps?: number;
  refinementSteps?: number;
  maxDistance?: number;
}

export interface TerrainRaycastResult {
  position: Vector3;
  normal: Vector3;
  distance: number;
}

export interface TerrainRaycast {
  pick(ray: Ray, options?: RaycastOptions): TerrainRaycastResult | null;
  pickAsync(ray: Ray, options?: RaycastOptions): Promise<TerrainRaycastResult | null>;
}