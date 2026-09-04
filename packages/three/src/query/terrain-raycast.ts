import { Vector3 } from "three";
import type { Ray } from "three";
import type { SurfaceProjection } from "../projection/types";
import type {
  RaycastOptions,
  TerrainQuery,
  TerrainRaycast,
  TerrainRaycastConfig,
  TerrainRaycastResult,
  TerrainSphereQuery,
  TerrainSurfaceQuery,
} from "./types";

export type { TerrainRaycastConfig };

/**
 * Build a terrain raycaster that delegates the projection-specific marching to
 * the active surface projection — no branching on a projection kind here.
 *
 * This is the consumer boundary: the projection's CPU marcher works on plain
 * `{ x, y, z }` objects (a `THREE.Ray` satisfies `RayLike` structurally, so it
 * is passed straight through) and the plain hit is converted once into
 * `THREE.Vector3`s for the caller.
 */
export function createTerrainRaycast(params: {
  getProjection: () => SurfaceProjection;
  getTerrainQuery: () => TerrainQuery | null;
  getSurfaceQuery: () => TerrainSurfaceQuery | null;
  getSphereQuery: () => TerrainSphereQuery | null;
  getConfig: () => TerrainRaycastConfig;
}): TerrainRaycast {
  return {
    pick(ray: Ray, options?: RaycastOptions): TerrainRaycastResult | null {
      const projection = params.getProjection();
      const hit = projection.cpu.raycast({
        ray,
        options,
        terrainQuery: params.getTerrainQuery(),
        surfaceQuery: params.getSurfaceQuery(),
        sphereQuery: params.getSphereQuery(),
        config: params.getConfig(),
      });
      if (!hit) return null;
      return {
        position: new Vector3(hit.position.x, hit.position.y, hit.position.z),
        normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
        distance: hit.distance,
      };
    },
  };
}
