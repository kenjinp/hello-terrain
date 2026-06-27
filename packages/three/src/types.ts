import type { UniformNode, Vector3, Vector3Like } from "three/webgpu";
import type { StorageBufferAttribute, StorageBufferNode } from "three/webgpu";

export interface TerrainUniformsParams {
  rootSize: number;
  rootOrigin: Vector3Like;
  innerTileSegments: number;
  skirtScale: number;
  elevationScale: number;
  radius: number;
  instanceId: string;
}

export interface TerrainUniformsContext {
  uRootOrigin: UniformNode<Vector3>;
  uRootSize: UniformNode<number>;
  uInnerTileSegments: UniformNode<number>;
  uSkirtScale: UniformNode<number>;
  uElevationScale: UniformNode<number>;
  uRadius: UniformNode<number>;
}

export interface LeafStorageState {
  data: Int32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

export interface VisibleSlotStorageState {
  data: Uint32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}
