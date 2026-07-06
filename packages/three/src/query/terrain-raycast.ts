import type { Ray } from 'three';
import type { SurfaceProjection } from '../projection/types';
import type {
    RaycastOptions,
    TerrainQuery,
    TerrainRaycast,
    TerrainRaycastConfig,
    TerrainRaycastResult,
    TerrainSphereQuery,
    TerrainSurfaceQuery,
} from './types';

export type { TerrainRaycastConfig };

/**
 * Build a terrain raycaster that delegates the projection-specific marching to
 * the active surface projection — no branching on a projection kind here.
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
            return projection.cpu.raycast({
                ray,
                options,
                terrainQuery: params.getTerrainQuery(),
                surfaceQuery: params.getSurfaceQuery(),
                sphereQuery: params.getSphereQuery(),
                config: params.getConfig(),
            });
        },
    };
}
