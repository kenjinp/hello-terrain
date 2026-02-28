import { task } from "@hello-terrain/work";
import { createTerrainRaycast } from "../query/terrain-raycast";
import type { TerrainQuery, TerrainRaycast } from "../query/types";
import { elevationScale, origin, rootSize } from "./params";
import { terrainQueryTask } from "./terrain-query.task";

const BOUNDS_PADDING = 1;

const terrainRaycastTaskState: {
  raycast?: TerrainRaycast;
  terrainQuery: TerrainQuery | null;
  bounds: {
    rootSize: number;
    originX: number;
    originZ: number;
    minY: number;
    maxY: number;
  };
} = {
  terrainQuery: null,
  bounds: {
    rootSize: 0,
    originX: 0,
    originZ: 0,
    minY: 0,
    maxY: 0,
  },
};

export const terrainRaycastTask = task(
  (get, work) => {
    const terrainQuery = get(terrainQueryTask);
    const rootSizeValue = get(rootSize);
    const originValue = get(origin);
    const elevationScaleValue = get(elevationScale);

    return work(() => {
      const state = terrainRaycastTaskState;
      state.terrainQuery = terrainQuery;
      state.bounds.rootSize = rootSizeValue;
      state.bounds.originX = originValue.x;
      state.bounds.originZ = originValue.z;

      const range = terrainQuery.getGlobalElevationRange();
      if (range) {
        state.bounds.minY = range.min - BOUNDS_PADDING;
        state.bounds.maxY = range.max + BOUNDS_PADDING;
      } else {
        const verticalExtent = Math.max(1, Math.abs(elevationScaleValue) * 2);
        state.bounds.minY = originValue.y - verticalExtent;
        state.bounds.maxY = originValue.y + verticalExtent;
      }

      if (!state.raycast) {
        state.raycast = createTerrainRaycast({
          getTerrainQuery: () => state.terrainQuery,
          getConfig: () => state.bounds,
        });
      }

      return state.raycast;
    });
  },
).displayName("terrainRaycastTask");
