import type { Ray } from "three";
import {
  cpuRaycast,
  cpuRaycastBoundsOnly,
  cubeSphereRaycast,
  cubeSphereRaycastBoundsOnly,
  type CpuRaycastConfig,
} from "./cpu-raycast";
import type {
  RaycastOptions,
  TerrainQuery,
  TerrainRaycast,
  TerrainRaycastResult,
  TerrainSphereQuery,
} from "./types";

export type TerrainRaycastConfig = CpuRaycastConfig;

export function createTerrainRaycast(params: {
  getTerrainQuery: () => TerrainQuery | null;
  getSphereQuery: () => TerrainSphereQuery | null;
  getConfig: () => TerrainRaycastConfig;
}): TerrainRaycast {
  return {
    pick(ray: Ray, options?: RaycastOptions): TerrainRaycastResult | null {
      const config = params.getConfig();
      const terrainQuery = params.getTerrainQuery();

      if (config.projection === "cubeSphere") {
        const sphereQuery = params.getSphereQuery();
        if (sphereQuery) {
          const precise = cubeSphereRaycast(sphereQuery, ray, config, options);
          if (precise) return precise;
        }
        return cubeSphereRaycastBoundsOnly(ray, config, options);
      }

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
    },
  };
}
