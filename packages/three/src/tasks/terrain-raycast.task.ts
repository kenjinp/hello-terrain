import { task } from "@hello-terrain/work";
import type { SurfaceProjection } from "../quadtree";
import { createTerrainRaycast } from "../query/terrain-raycast";
import type { TerrainQuery, TerrainRaycast, TerrainSphereQuery } from "../query/types";
import { elevationScale, origin, radius, rootSize } from "./params";
import { surfaceTask } from "./quadtree.task";
import { terrainQueryTask } from "./terrain-query.task";

const BOUNDS_PADDING = 1;
const RAYCAST_STATE = Symbol("terrainRaycastTaskState");

type TerrainRaycastTaskState = {
  terrainQuery: TerrainQuery | null;
  sphereQuery: TerrainSphereQuery | null;
  bounds: {
    rootSize: number;
    originX: number;
    originZ: number;
    minY: number;
    maxY: number;
    projection: SurfaceProjection;
    centerX: number;
    centerY: number;
    centerZ: number;
    radius: number;
    minRadius: number;
    maxRadius: number;
  };
};
type TerrainRaycastWithState = TerrainRaycast & {
  [RAYCAST_STATE]?: TerrainRaycastTaskState;
};

export const terrainRaycastTask = task(
  (get, work) => {
    const { query: terrainQuery, sphereQuery } = get(terrainQueryTask);
    const rootSizeValue = get(rootSize);
    const originValue = get(origin);
    const elevationScaleValue = get(elevationScale);
    const radiusValue = get(radius);
    const surfaceValue = get(surfaceTask);
    const projection = surfaceValue.projection ?? "flat";
    const sphereRadius = surfaceValue.radius ?? radiusValue;

    return work((prev?: TerrainRaycast): TerrainRaycast => {
      let raycast = prev as TerrainRaycastWithState | undefined;
      let state = raycast?.[RAYCAST_STATE];
      if (!state) {
        state = {
          terrainQuery: null,
          sphereQuery: null,
          bounds: {
            rootSize: 0,
            originX: 0,
            originZ: 0,
            minY: 0,
            maxY: 0,
            projection: "flat",
            centerX: 0,
            centerY: 0,
            centerZ: 0,
            radius: 0,
            minRadius: 0,
            maxRadius: 0,
          },
        };
      }

      state.terrainQuery = terrainQuery;
      state.sphereQuery = sphereQuery;
      state.bounds.rootSize = rootSizeValue;
      state.bounds.originX = originValue.x;
      state.bounds.originZ = originValue.z;
      state.bounds.projection = projection;
      state.bounds.centerX = originValue.x;
      state.bounds.centerY = originValue.y;
      state.bounds.centerZ = originValue.z;
      state.bounds.radius = sphereRadius;

      const range = terrainQuery.getGlobalElevationRange();
      if (range) {
        state.bounds.minY = range.min - BOUNDS_PADDING;
        state.bounds.maxY = range.max + BOUNDS_PADDING;
      } else {
        const verticalExtent = Math.max(1, Math.abs(elevationScaleValue) * 2);
        state.bounds.minY = originValue.y - verticalExtent;
        state.bounds.maxY = originValue.y + verticalExtent;
      }

      // Radial shell bounds for cube-sphere. The cached global range stores
      // `originY + displacement`; subtract centerY to recover the displacement.
      const elevationExtent = Math.max(1, Math.abs(elevationScaleValue));
      let dispMin = -elevationExtent;
      let dispMax = elevationExtent;
      if (range) {
        dispMin = range.min - originValue.y;
        dispMax = range.max - originValue.y;
      }
      state.bounds.minRadius = Math.max(0, sphereRadius + dispMin - BOUNDS_PADDING);
      state.bounds.maxRadius = sphereRadius + dispMax + BOUNDS_PADDING;

      if (!raycast) {
        raycast = createTerrainRaycast({
          getTerrainQuery: () => state.terrainQuery,
          getSphereQuery: () => state.sphereQuery,
          getConfig: () => state.bounds,
        }) as TerrainRaycastWithState;
      }
      raycast[RAYCAST_STATE] = state;

      return raycast;
    });
  },
).displayName("terrainRaycastTask");
