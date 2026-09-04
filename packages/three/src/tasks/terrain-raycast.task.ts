import { task } from "@hello-terrain/work";
import type { SurfaceProjection } from "../projection/types";
import { createTerrainRaycast } from "../query/terrain-raycast";
import type {
  TerrainQuery,
  TerrainRaycast,
  TerrainRaycastConfig,
  TerrainSphereQuery,
  TerrainSurfaceQuery,
} from "../query/types";
import { elevationScale, origin, radius, rootSize } from "./params";
import { topologyTask } from "./quadtree.task";
import { terrainQueryTask } from "./terrain-query.task";
import { resolveTerrainWorldConfig } from "./world-config";

const BOUNDS_PADDING = 1;
const RAYCAST_STATE = Symbol("terrainRaycastTaskState");

type TerrainRaycastTaskState = {
  projection: SurfaceProjection;
  terrainQuery: TerrainQuery | null;
  surfaceQuery: TerrainSurfaceQuery | null;
  sphereQuery: TerrainSphereQuery | null;
  config: TerrainRaycastConfig;
};
type TerrainRaycastWithState = TerrainRaycast & {
  [RAYCAST_STATE]?: TerrainRaycastTaskState;
};

export const terrainRaycastTask = task(
  (get, work) => {
    const { query: terrainQuery, surfaceQuery, sphereQuery } = get(terrainQueryTask);
    const elevationScaleValue = get(elevationScale);
    const topologyValue = get(topologyTask);
    const projection = topologyValue.projection;
    // Topology owns rootSize/origin; params are only a fallback.
    const world = resolveTerrainWorldConfig(topologyValue, {
      rootSize: get(rootSize),
      origin: get(origin),
      radius: get(radius),
    });
    const originValue = world.origin;

    return work((prev?: TerrainRaycast): TerrainRaycast => {
      let raycast = prev as TerrainRaycastWithState | undefined;
      let state = raycast?.[RAYCAST_STATE];
      if (!state) {
        state = {
          projection,
          terrainQuery: null,
          surfaceQuery: null,
          sphereQuery: null,
          config: {
            rootSize: 0,
            originX: 0,
            originY: 0,
            originZ: 0,
            minY: 0,
            maxY: 0,
            centerX: 0,
            centerY: 0,
            centerZ: 0,
          },
        };
      }

      state.projection = projection;
      state.terrainQuery = terrainQuery;
      state.surfaceQuery = surfaceQuery;
      state.sphereQuery = sphereQuery;
      state.config.rootSize = world.rootSize;
      state.config.originX = originValue.x;
      state.config.originY = originValue.y;
      state.config.originZ = originValue.z;
      state.config.centerX = projection.center?.x ?? originValue.x;
      state.config.centerY = projection.center?.y ?? originValue.y;
      state.config.centerZ = projection.center?.z ?? originValue.z;

      const range = terrainQuery.getGlobalElevationRange();
      if (range) {
        state.config.minY = range.min - BOUNDS_PADDING;
        state.config.maxY = range.max + BOUNDS_PADDING;
      } else {
        const verticalExtent = Math.max(1, Math.abs(elevationScaleValue) * 2);
        state.config.minY = originValue.y - verticalExtent;
        state.config.maxY = originValue.y + verticalExtent;
      }

      if (!raycast) {
        raycast = createTerrainRaycast({
          getProjection: () => state.projection,
          getTerrainQuery: () => state.terrainQuery,
          getSurfaceQuery: () => state.surfaceQuery,
          getSphereQuery: () => state.sphereQuery,
          getConfig: () => state.config,
        }) as TerrainRaycastWithState;
      }
      raycast[RAYCAST_STATE] = state;

      return raycast;
    });
  },
).displayName("terrainRaycastTask");
