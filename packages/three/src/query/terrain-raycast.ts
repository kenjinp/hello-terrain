import type { Ray } from "three";
import type { WebGPURenderer } from "three/webgpu";
import {
  cpuRaycast,
  cpuRaycastBoundsOnly,
  type CpuRaycastConfig,
} from "./cpu-raycast";
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
  getTerrainQuery: () => TerrainQuery | null;
  terrainSampler: TerrainSampler;
  renderer: WebGPURenderer;
  getConfig: () => TerrainRaycastConfig;
}): TerrainRaycast {
  const pickWithFallback = (
    ray: Ray,
    options?: RaycastOptions,
  ): TerrainRaycastResult | null => {
    const config = params.getConfig();
    const terrainQuery = params.getTerrainQuery();
    if (terrainQuery) {
      const precise = cpuRaycast(terrainQuery, ray, config, options);
      if (precise) return precise;
    }
    const coarse = cpuRaycastBoundsOnly(ray, config, options);
    if (coarse && terrainQuery) {
      const sample = terrainQuery.sampleTerrain(
        coarse.position.x,
        coarse.position.z,
      );
      if (sample.valid) {
        coarse.position.y = sample.elevation;
        coarse.normal.copy(sample.normal);
      }
    }
    return coarse;
  };

  const gpuRaycast = createGpuRaycastRunner({
    renderer: params.renderer,
    terrainSampler: params.terrainSampler,
    cpuFallback: pickWithFallback,
  });

  return {
    pick(ray: Ray, options?: RaycastOptions): TerrainRaycastResult | null {
      return pickWithFallback(ray, options);
    },
    pickAsync(
      ray: Ray,
      options?: RaycastOptions,
    ): Promise<TerrainRaycastResult | null> {
      return gpuRaycast.pickAsync(ray, options);
    },
  };
}
