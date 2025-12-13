export { TerrainGeometry } from "./geometry/TerrainGeometry";
export {
  ElevationFn,
  type ElevationCallback,
  type ElevationParams,
  type ElevationReturn,
} from "./nodes/ElevationFn";
export {
  ControlFn,
  type ControlCallback,
  type ControlParams,
  type ControlReturn,
} from "./nodes/ControlFn";
export { createControl } from "./nodes/control";

// Export instance-specific uniform and varying classes
export { TerrainUniforms } from "./TerrainUniforms";
export { TerrainVaryings } from "./TerrainVaryings";

// Export factory functions for creating instance-specific nodes
export {
  createIsSkirtFragment,
  createIsSkirtVertex,
  createIsSkirtCompute,
} from "./nodes/skirt";
export {
  createRootUV,
  createRootUVCompute,
  createTileIsLeaf,
  createTileLevel,
  createTileOriginVec2,
  createTileVertexWorldPosition,
  createTileGeometryPosition,
  createTileVertexWorldPositionCompute,
  createTileSize,
} from "./nodes/tile";
export {
  createHeight,
  readHeightVertex,
  readHeightAtPositionLocal,
} from "./nodes/height";
export { createWorldPosition } from "./nodes/position";
export {
  createReadNormalAtPositionLocal,
  blendNormalsRNM,
} from "./nodes/normals";

// Export quadtree and terrain mesh
export { Quadtree, type QuadtreeParams } from "./quadtree/Quadtree";
export { TerrainMesh, type TerrainMeshParams } from "./TerrainMesh";

// Export texture system
export {
  TerrainTextureArray,
  type TextureSetOptions,
} from "./texture/TerrainTextureArray";
export {
  ControlDataPacker,
  type ControlData,
} from "./compute/ControlStorage";
export { createReadControlAtVertex } from "./nodes/controlData";
export {
  sampleTextureArray,
  heightBlend,
  slopeBlend,
} from "./nodes/textureArraySampling";
export {
  createTerrainColorNode,
  createTerrainNormalNode,
  createTerrainRoughnessNode,
  type TerrainTextureMaterialParams,
} from "./nodes/terrainTextureMaterial";
