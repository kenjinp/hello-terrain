import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import { createTerrainRaycast } from "../query/terrain-raycast";
import type { TerrainQuery, TerrainRaycast } from "../query/types";
import { elevationScale, origin, rootSize } from "./params";
import { terrainQueryTask } from "./terrain-query.task";
import { createTerrainSamplerTask } from "./terrain-sampler.task";

const terrainRaycastTaskState: {
  raycast?: TerrainRaycast;
  renderer?: WebGPURenderer;
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

export const terrainRaycastTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const terrainQuery = get(terrainQueryTask);
    const terrainSampler = get(createTerrainSamplerTask);
    const rootSizeValue = get(rootSize);
    const originValue = get(origin);
    const elevationScaleValue = get(elevationScale);

    return work(() => {
      const state = terrainRaycastTaskState;
      state.terrainQuery = terrainQuery;
      const verticalExtent = Math.max(1, Math.abs(elevationScaleValue) * 2);
      state.bounds.rootSize = rootSizeValue;
      state.bounds.originX = originValue.x;
      state.bounds.originZ = originValue.z;
      state.bounds.minY = originValue.y - verticalExtent;
      state.bounds.maxY = originValue.y + verticalExtent;

      if (resources?.renderer && state.renderer !== resources.renderer) {
        state.renderer = resources.renderer;
        state.raycast = createTerrainRaycast({
          renderer: resources.renderer,
          getTerrainQuery: () => state.terrainQuery,
          terrainSampler,
          getConfig: () => state.bounds,
        });
      }

      if (!state.raycast && resources?.renderer) {
        state.renderer = resources.renderer;
        state.raycast = createTerrainRaycast({
          renderer: resources.renderer,
          getTerrainQuery: () => state.terrainQuery,
          terrainSampler,
          getConfig: () => state.bounds,
        });
      }

      if (!state.raycast) {
        throw new Error(
          "terrainRaycastTask requires a renderer resource. Run graph with { resources: { renderer } }.",
        );
      }

      return state.raycast;
    });
  },
).displayName("terrainRaycastTask");
