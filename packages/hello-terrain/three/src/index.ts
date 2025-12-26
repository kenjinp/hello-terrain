export { TerrainGeometry } from "./geometry/TerrainGeometry";

// Compute DAG API (composable compute stages)
export { ComputeDAG, type ComputeDAGConfig } from "./compute/ComputeDAG";
export type {
  ComputeStageConfig,
  ComputeStageContext,
  ComputeStageFn,
  ComputeStageName,
  ComputeStageOutputConfig,
} from "./compute/ComputeStage";
export {
  createControlmapStage,
  createHeightmapStage,
  createNormalmapStage,
} from "./compute/stages";
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
  computeScreenSpaceInfo,
  // Built-in subdivision strategies
  distanceBasedSubdivision,
  Quadtree,
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
  createTerrainMaterialNodes,
  TRIPLANAR_DEBUG_OFF,
  TRIPLANAR_DEBUG_TINTED,
  TRIPLANAR_DEBUG_WEIGHTS,
  type TerrainMaterialNodes,
  type TerrainTextureMaterialEnhancedParams,
  type TerrainTextureMaterialParams,
  type TerrainTextureMaterialTriplanarNoTileParams,
  type TerrainTextureMaterialTriplanarParams,
} from "./nodes/terrainTextureMaterial";
export {
  adjustSaturation,
  createTerrainSamplerFunctions,
  heightBlendMask,
  sampleTriplanarNoTile,
  slopeBlend,
} from "./nodes/textureArraySampling";
export {
  TerrainTextureArray,
  type TextureSetOptions,
} from "./texture/TerrainTextureArray";

// Export storage properties for advanced shader customization
export { controlmapStorageProperty } from "./nodes/properties";
