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
  maxNodes,
  maxLevel,
  cameraProjectionMatrix,
  cameraProjectionViewMatrix,
  cameraViewMatrix,
  frustumCulling,
  occlusionCulling,
  hiZResolution,
  quadtreeUpdate,
  surface,
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

export * from "./tsl/materials";
export * from "./tsl/skirt";
export * from "./tsl/varyings";
export * from "./tsl/voronoi";

export * from "./quadtree";
export * from "./tasks";
export * from "./types";
