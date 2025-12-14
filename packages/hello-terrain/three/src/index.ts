export { TerrainGeometry } from "./geometry/TerrainGeometry";
export { createControl } from "./nodes/control";
export {
  ControlFn,
  type ControlCallback,
  type ControlParams,
  type ControlReturn,
} from "./nodes/ControlFn";
export {
  ElevationFn,
  type ElevationCallback,
  type ElevationParams,
  type ElevationReturn,
} from "./nodes/ElevationFn";

// Export instance-specific uniform and varying classes
export { TerrainUniforms } from "./TerrainUniforms";
export { TerrainVaryings } from "./TerrainVaryings";

// Export factory functions for creating instance-specific nodes
export {
  createHeight,
  readHeightAtPositionLocal,
  readHeightVertex,
} from "./nodes/height";
export {
  blendNormalsRNM,
  createReadNormalAtPositionLocal,
} from "./nodes/normals";
export { createWorldPosition } from "./nodes/position";
export {
  createIsSkirtCompute,
  createIsSkirtFragment,
  createIsSkirtVertex,
} from "./nodes/skirt";
export {
  createRootUV,
  createRootUVCompute,
  createTileGeometryPosition,
  createTileIsLeaf,
  createTileLevel,
  createTileOriginVec2,
  createTileSize,
  createTileVertexWorldPosition,
  createTileVertexWorldPositionCompute,
} from "./nodes/tile";

// Export quadtree and terrain mesh
export {
  Quadtree,
  computeScreenSpaceInfo,
  // Built-in subdivision strategies
  distanceBasedSubdivision,
  screenSpaceSubdivision,
  type QuadtreeParams,
  type ScreenSpaceInfo,
  // Subdivision strategy types and helpers
  type SubdivisionContext,
  type SubdivisionStrategy,
} from "./quadtree/Quadtree";
export { TerrainMesh, type TerrainMeshParams } from "./TerrainMesh";

// Export texture system
export {
  ControlDataPacker,
  type ControlData,
} from "./compute/ControlStorage";
export { createReadControlAtVertex } from "./nodes/controlData";
export {
  TRIPLANAR_DEBUG_OFF,
  TRIPLANAR_DEBUG_TINTED,
  TRIPLANAR_DEBUG_WEIGHTS,
  createTerrainColorNode,
  createTerrainColorNodeTriplanar,
  createTerrainColorNodeTriplanarDebug,
  createTerrainColorNodeTriplanarNoTile,
  createTerrainNormalNode,
  createTerrainNormalNodeTriplanar,
  createTerrainRoughnessNode,
  createTerrainRoughnessNodeTriplanar,
  createTerrainRoughnessNodeTriplanarNoTile,
  type TerrainTextureMaterialParams,
  type TerrainTextureMaterialTriplanarDebugParams,
  type TerrainTextureMaterialTriplanarNoTileParams,
  type TerrainTextureMaterialTriplanarParams,
} from "./nodes/terrainTextureMaterial";
export {
  heightBlend,
  sampleTextureArray,
  sampleTextureArrayNoTile,
  sampleTextureArrayTriplanar,
  sampleTextureArrayTriplanarDebug,
  sampleTextureArrayTriplanarNoTile,
  sampleTextureArrayTriplanarSimple,
  slopeBlend,
  triplanarDebugWeights,
} from "./nodes/textureArraySampling";
export {
  TerrainTextureArray,
  type TextureSetOptions,
} from "./texture/TerrainTextureArray";

// Export storage properties for advanced shader customization
export { controlmapStorageProperty } from "./nodes/properties";
