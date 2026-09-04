export { TerrainGeometry } from "./geometry/TerrainGeometry";
export { TerrainMesh } from "./mesh/TerrainMesh";
export { terrainGraph, terrainTasks } from "./tasks/graph";
export type { TerrainTasks, TerrainGraph } from "./tasks/graph.types";

export {
  rootSize,
  origin,
  innerTileSegments,
  skirtScale,
  elevationScale,
  radius,
  maxNodes,
  maxLevel,
  quadtreeUpdate,
  topology,
  terrainFieldFilter,
  elevationFn,
} from "./tasks/params";

export type { ElevationCallback, ElevationParams } from "./tsl/elevation";
export type { ComputeStageCallback, ComputePipeline } from "./gpu/compute";
export { getDeviceComputeLimits } from "./gpu/deviceLimits";
export * from "./gpu/terrainFieldStorage";
export * from "./query/terrain-sampler";
export * from "./query/terrain-query";
export * from "./query/terrain-raycast";
export * from "./query/types";
export { createComputePipelineTasks } from "./tasks/compute.task";

export * from "./tsl/cubeSphere";
export * from "./tsl/elevationTexture";
export * from "./tsl/materials";
export * from "./tsl/skirt";
export * from "./tsl/varyings";
export * from "./tsl/voronoi";

export * from "./projection";
export * from "./types";

// ── Quadtree (CPU LOD topology) ─────────────────────────────────────────
// Only the topology contract, its factories, and the data types that flow
// through the task graph are public. The LOD driver (`update`, `createState`,
// seam/leaf-set allocators, spatial-index builders) stays internal.
export {
  Dir,
  type TileId,
  type TileBounds,
  type ElevationRangeOut,
  type Topology,
  type LeafSet,
  type LodMode,
  type LodCriteria,
  type TileElevationRangeFn,
  type UpdateParams,
  type QuadtreeConfig,
} from "./quadtree/types";
export type { QuadtreeState } from "./quadtree/state";
export type { SpatialIndex } from "./quadtree/spatialIndex";
export { createFlatTopology, type FlatTopologyConfig } from "./quadtree/topology/flat";
export {
  createInfiniteFlatTopology,
  type InfiniteFlatTopologyConfig,
} from "./quadtree/topology/infiniteFlat";
export {
  createCubeSphereTopology,
  type CubeSphereTopologyConfig,
} from "./quadtree/topology/cubeSphere";
export {
  CUBE_FACES,
  CUBE_FACE_COUNT,
  type CubeFace,
  type Vec3,
} from "./quadtree/topology/cubeSphereFaces";
export {
  faceUVToCube,
  directionToFace,
  directionToFaceUV,
  latLongToDirection,
  directionToLatLong,
  type Vec3Mutable,
} from "./quadtree/topology/cubeSphereInverse";
export { createTorusTopology, type TorusTopologyConfig } from "./quadtree/topology/torus";
export {
  wrap01,
  torusUVToPoint,
  torusOutwardNormal,
  positionToTorusParams,
  type TorusSurfaceParams,
} from "./quadtree/topology/torusInverse";

// ── Tasks (advanced: individual task refs) ──────────────────────────────
export type {
  QuadtreeConfigState,
  LeafGpuBufferState,
  ElevationFieldContext,
  TerrainQueryContext,
} from "./tasks/graph.types";
export { instanceIdTask } from "./tasks/instanceId.task";
export {
  topologyTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
  leafStorageTask,
  leafGpuBufferTask,
} from "./tasks/quadtree.task";
export {
  gpuSpatialIndexStorageTask,
  gpuSpatialIndexUploadTask,
} from "./tasks/gpuSpatialIndex.task";
export { createUniformsTask, updateUniformsTask } from "./tasks/uniforms/uniforms.task";
export { createTerrainUniforms } from "./tasks/uniforms/terrainUniforms";
export { positionNodeTask } from "./tasks/positions.task";
export {
  createElevationFieldContextTask,
  tileNodesTask,
  elevationFieldStageTask,
} from "./tasks/elevation-field.task";
export {
  createTerrainFieldStorageTask,
  createTerrainFieldTextureTask,
  terrainFieldStageTask,
} from "./tasks/terrain-field.task";
export { createTerrainSamplerTask } from "./tasks/terrain-sampler.task";
export {
  compileComputeTask,
  executeComputeTask,
  tileBoundsReductionTask,
} from "./tasks/compute.task";
export { tileBoundsContextTask, type TileBoundsContext } from "./tasks/tile-bounds.task";
export { terrainQueryTask, terrainReadbackTask } from "./tasks/terrain-query.task";
export { terrainRaycastTask } from "./tasks/terrain-raycast.task";
