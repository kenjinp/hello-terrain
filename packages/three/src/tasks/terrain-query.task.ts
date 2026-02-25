import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import {
  createCpuTerrainCache,
  type CpuTerrainCache,
} from "../query/cpu-terrain-cache";
import { createTerrainQuery } from "../query/terrain-query";
import type { TerrainQuery } from "../query/types";
import {
  elevationScale,
  innerTileSegments,
  maxLevel,
  maxNodes,
  origin,
  rootSize,
} from "./params";
import { quadtreeConfigTask } from "./quadtree.task";
import { executeComputeTask } from "./compute.task";
import { createElevationFieldContextTask } from "./elevation-field.task";

export const terrainQueryTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    // Ensure readback is scheduled after compute dispatch.
    get(executeComputeTask);

    const elevationFieldContext = get(createElevationFieldContextTask);
    const quadtreeConfig = get(quadtreeConfigTask);
    const maxNodesValue = get(maxNodes);
    const innerTileSegmentsValue = get(innerTileSegments);
    const maxLevelValue = get(maxLevel);
    const rootSizeValue = get(rootSize);
    const originValue = get(origin);
    const elevationScaleValue = get(elevationScale);

    return work((): TerrainQuery | null => {
      const state = terrainQueryTaskState;
      const shapeKey = `${maxNodesValue}:${innerTileSegmentsValue}`;
      if (!state.cache || state.shapeKey !== shapeKey) {
        state.cache = createCpuTerrainCache(maxNodesValue, {
          rootSize: rootSizeValue,
          originX: originValue.x,
          originY: originValue.y,
          originZ: originValue.z,
          innerTileSegments: innerTileSegmentsValue,
          elevationScale: elevationScaleValue,
          maxLevel: maxLevelValue,
        });
        state.query = createTerrainQuery(state.cache);
        state.shapeKey = shapeKey;
      }

      state.cache.updateConfig({
        rootSize: rootSizeValue,
        originX: originValue.x,
        originY: originValue.y,
        originZ: originValue.z,
        innerTileSegments: innerTileSegmentsValue,
        elevationScale: elevationScaleValue,
        maxLevel: maxLevelValue,
      });

      if (resources?.renderer) {
        state.cache.triggerReadback(
          resources.renderer,
          elevationFieldContext.attribute,
          quadtreeConfig.state.leafIndex,
        );
      }

      if (!state.cache.ready) return null;
      return state.query!;
    });
  },
).displayName("terrainQueryTask");

const terrainQueryTaskState: {
  cache?: CpuTerrainCache;
  query?: TerrainQuery;
  shapeKey?: string;
} = {};
