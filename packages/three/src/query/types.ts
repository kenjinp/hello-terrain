import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
import type { ElevationCallback } from "../tsl/elevation";
import type { TerrainUniformsContext } from "../types";
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