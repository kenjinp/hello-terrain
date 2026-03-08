import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import { createCpuTerrainCache } from "../query/cpu-terrain-cache";
import { createTerrainQuery } from "../query/terrain-query";
import type { TerrainQueryContext } from "./graph.types";
import { createElevationFieldContextTask } from "./elevation-field.task";
import { elevationScale, innerTileSegments, maxLevel, maxNodes, origin, rootSize } from "./params";
import { leafGpuBufferTask, quadtreeConfigTask } from "./quadtree.task";
import { tileBoundsReductionTask } from "./tile-bounds.task";

export const terrainQueryTask = task((get, work) => {
  const maxNodesValue = get(maxNodes);
  const innerTileSegmentsValue = get(innerTileSegments);
  const maxLevelValue = get(maxLevel);
  const rootSizeValue = get(rootSize);
  const originValue = get(origin);
  const elevationScaleValue = get(elevationScale);

  return work((prev?: TerrainQueryContext): TerrainQueryContext => {
    const shapeKey = `${maxNodesValue}:${innerTileSegmentsValue}`;
    const configValues = {
      rootSize: rootSizeValue,
      originX: originValue.x,
      originY: originValue.y,
      originZ: originValue.z,
      innerTileSegments: innerTileSegmentsValue,
      elevationScale: elevationScaleValue,
      maxLevel: maxLevelValue,
    };

    let cache = prev?.cache;
    let query = prev?.query;

    if (!cache || !query || prev?.shapeKey !== shapeKey) {
      cache = createCpuTerrainCache(maxNodesValue, configValues);
      query = createTerrainQuery(cache);
    }

    cache.updateConfig(configValues);

    return { cache, query, shapeKey };
  });
}).displayName("terrainQueryTask");

export const terrainReadbackTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const boundsContext = get(tileBoundsReductionTask);
    const elevationFieldContext = get(createElevationFieldContextTask);
    const quadtreeConfig = get(quadtreeConfigTask);
    const leafState = get(leafGpuBufferTask);
    const { cache } = get(terrainQueryTask);

    return work((): void => {
      if (!resources?.renderer) return;

      cache.triggerReadback(
        resources.renderer,
        elevationFieldContext.attribute,
        quadtreeConfig.state.leafIndex,
        boundsContext.attribute,
        leafState.count,
      );
    });
  },
)
  .displayName("terrainReadbackTask")
  .lane("gpu");
