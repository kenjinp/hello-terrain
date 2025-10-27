export { TerrainGeometry } from "./geometry/TerrainGeometry";
export {
  ElevationFn,
  type ElevationCallback,
  type ElevationParams,
  type ElevationReturn,
} from "./nodes/ElevationFn";
export { isSkirtFragment, isSkirtVertex } from "./nodes/skirt";
export {
  rootUV,
  tileIsLeaf,
  tileLevel,
  tileOriginVec2,
  tileVertexWorldPosition,
  tileGeometryPosition,
} from "./nodes/tile";
export {
  uRootOrigin,
  uRootSize,
  uSegments,
  uSkirtHeight,
} from "./nodes/uniforms";
export { Quadtree, type QuadtreeParams } from "./quadtree/Quadtree";
export { TerrainMesh, type TerrainMeshParams } from "./TerrainMesh";
export { readHeightVertex, readHeightAtPositionLocal } from "./nodes/height";
export { worldPosition } from "./nodes/position";
export { readNormalAtPositionLocal, blendNormalsRNM } from "./nodes/normals";
export { vNormal } from "./nodes/varyings";
