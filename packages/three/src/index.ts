export { TerrainGeometry } from "./geometry/TerrainGeometry";
export type { TerrainGeometryOptions } from "./geometry/TerrainGeometry";
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
  cameraView,
  residencyAnchors,
  lodCriteria,
  topology,
  terrainFieldFilter,
  elevationFn,
} from "./tasks/params";

export {
  readCameraView,
  createInitialCameraView,
  createCameraViewEquals,
  cameraViewEquals,
  DEFAULT_CAMERA_ORIGIN_HYSTERESIS,
  type CameraView,
  type CameraViewEqualsConfig,
} from "./tasks/cameraView";

export {
  cloneResidencyAnchors,
  createResidencyAnchorsEquals,
  residencyAnchorsEquals,
  DEFAULT_RESIDENCY_HYSTERESIS,
  type ResidencyAnchorsEqualsConfig,
} from "./tasks/residencyAnchorsParam";

export { terrainTargets, type TerrainPipelineOptions, type TerrainRunResources } from "./tasks/terrainTargets";

export type { ElevationCallback, ElevationParams } from "./tsl/elevation";
export type { ComputeStageCallback, ComputePipeline } from "./gpu/compute";
export { getDeviceComputeLimits } from "./gpu/deviceLimits";
export { createGpuProfiler } from "./gpu/gpuProfiler";
export type {
  GpuComputePassTiming,
  GpuFrameTimings,
  GpuProfiler,
} from "./gpu/gpuProfiler";
export * from "./gpu/terrainFieldStorage";
export * from "./query/terrain-sampler";
export * from "./query/terrain-query";
export * from "./query/terrain-raycast";
export * from "./query/types";
export { createComputePipelineTasks } from "./tasks/compute.task";

export * from "./tsl/cubeSphere";
export * from "./tsl/materials";
export * from "./tsl/skirt";
export * from "./tsl/varyings";
export * from "./tsl/voronoi";

export * from "./projection";
export * from "./quadtree";
export * from "./tasks";
export * from "./types";
