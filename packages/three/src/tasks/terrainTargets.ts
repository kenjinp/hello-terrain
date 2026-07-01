import type { TaskRef } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import { terrainTasks } from "./graph";

export type TerrainPipelineOptions = {
  compute?: boolean;
  readback?: boolean;
  gpuSpatialIndex?: boolean;
};

export type TerrainRunTask = TaskRef<unknown> & {
  readonly _type?: unknown;
};

export function terrainTargets(
  options: TerrainPipelineOptions = {},
  extraTasks: readonly TerrainRunTask[] = [],
): TerrainRunTask[] {
  const runCompute = options.compute ?? true;
  const runReadback = options.readback ?? true;
  const runGpuSpatialIndex = options.gpuSpatialIndex ?? true;

  const targets: TerrainRunTask[] = [...extraTasks, terrainTasks.leafGpuBuffer];

  if (runCompute) {
    targets.push(terrainTasks.executeCompute);
    if (runReadback) targets.push(terrainTasks.terrainReadback);
  }
  if (runGpuSpatialIndex) targets.push(terrainTasks.gpuSpatialIndexUpload);

  return targets;
}

export type TerrainRunResources = {
  renderer: WebGPURenderer;
};
