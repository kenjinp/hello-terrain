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
export * from "./tsl/heightmap";
export * from "./tsl/materials";
export * from "./tsl/terrainMaterial";
export * from "./tsl/managedTexture";
export * from "./tsl/skirt";
export * from "./tsl/varyings";
export * from "./tsl/voronoi";

export * from "./projection";
export * from "./quadtree";
export * from "./tasks";
export * from "./types";
export { createTerrain } from "./runtime/three";
export { createTerrainBinding } from "./runtime/binding";
export type { TerrainBinding } from "./runtime/binding";
export type { Terrain, TerrainQuery, TerrainConfig, CreateTerrainOptions, TerrainRender } from "./runtime/three";
export type { TerrainQuery as LegacyTerrainQuery } from "./query/types";
export type { TerrainRevision, TerrainView, TerrainRuntimeStatus, TerrainSampleResult, TerrainSnapshotLease, TerrainRaycastOptions, TerrainRaycastSample } from "./runtime/runtime";
export * from "./runtime/source";
