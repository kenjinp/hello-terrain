import type { Ray } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { cpuRaycast, type CpuRaycastConfig } from "./cpu-raycast";
import { createGpuRaycastRunner } from "./gpu-raycast";
import type {
  RaycastOptions,
  TerrainQuery,
  TerrainRaycast,
  TerrainRaycastResult,
  TerrainSampler,
} from "./types";

export type TerrainRaycastConfig = CpuRaycastConfig;

export function createTerrainRaycast(params: {
  terrainQuery: TerrainQuery;
  terrainSampler: TerrainSampler;
  renderer: WebGPURenderer;
  getConfig: () => TerrainRaycastConfig;
}): TerrainRaycast {
  const gpuRaycast = createGpuRaycastRunner({
    renderer: params.renderer,
    terrainSampler: params.terrainSampler,
    cpuFallback: (ray, options) =>
      cpuRaycast(params.terrainQuery, ray, params.getConfig(), options),
  });

  return {
    pick(ray: Ray, options?: RaycastOptions): TerrainRaycastResult | null {
      return cpuRaycast(params.terrainQuery, ray, params.getConfig(), options);
    },
    pickAsync(
      ray: Ray,
      options?: RaycastOptions,
    ): Promise<TerrainRaycastResult | null> {
      return gpuRaycast.pickAsync(ray, options);
    },
  };
}
