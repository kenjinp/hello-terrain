import type {
  Matrix4,
  StorageBufferAttribute,
  StorageBufferNode,
  UniformNode,
  Vector3,
  Vector3Like,
  Vector4,
} from "three/webgpu";

export interface TerrainUniformsParams {
  rootSize: number;
  rootOrigin: Vector3Like;
  innerTileSegments: number;
  skirtScale: number;
  elevationScale: number;
  instanceId: string;
}

export interface TerrainCullingUniformsParams {
  cameraProjectionMatrix: Matrix4;
  cameraProjectionViewMatrix: Matrix4;
  cameraViewMatrix: Matrix4;
  frustumPlanes: readonly Vector4[];
  instanceId: string;
}

export interface TerrainUniformsContext {
  uRootOrigin: UniformNode<Vector3>;
  uRootSize: UniformNode<number>;
  uInnerTileSegments: UniformNode<number>;
  uSkirtScale: UniformNode<number>;
  uElevationScale: UniformNode<number>;
}

export interface TerrainCullingUniformsContext {
  uCameraProjectionMatrix: UniformNode<Matrix4>;
  uCameraProjectionViewMatrix: UniformNode<Matrix4>;
  uCameraViewMatrix: UniformNode<Matrix4>;
  uFrustumPlanes: readonly [
    UniformNode<Vector4>,
    UniformNode<Vector4>,
    UniformNode<Vector4>,
    UniformNode<Vector4>,
    UniformNode<Vector4>,
    UniformNode<Vector4>,
  ];
}

export interface LeafStorageState {
  data: Int32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}
