import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import { createCpuTerrainCache } from "../query/cpu-terrain-cache";
import { createTerrainQuery, createTerrainSphereQuery } from "../query/terrain-query";
import type { TerrainQueryContext } from "./graph.types";
import { createElevationFieldContextTask } from "./elevation-field.task";
import { elevationScale, innerTileSegments, maxLevel, maxNodes, origin, radius, rootSize } from "./params";
import { leafGpuBufferTask, quadtreeConfigTask, surfaceTask } from "./quadtree.task";
import { tileBoundsReductionTask } from "./tile-bounds.task";

export const terrainQueryTask = task((get, work) => {
  const maxNodesValue = get(maxNodes);
  const innerTileSegmentsValue = get(innerTileSegments);
  const maxLevelValue = get(maxLevel);
  const rootSizeValue = get(rootSize);
  const originValue = get(origin);
  const elevationScaleValue = get(elevationScale);
  const radiusValue = get(radius);
  const surfaceValue = get(surfaceTask);
  const projectionValue = surfaceValue.projection ?? "flat";

  return work((prev?: TerrainQueryContext): TerrainQueryContext => {
    const shapeKey = `${maxNodesValue}:${innerTileSegmentsValue}:${projectionValue}`;
    const configValues = {
      rootSize: rootSizeValue,
      originX: originValue.x,
      originY: originValue.y,
      originZ: originValue.z,
      innerTileSegments: innerTileSegmentsValue,
      elevationScale: elevationScaleValue,
      maxLevel: maxLevelValue,
      projection: projectionValue,
      radius: surfaceValue.radius ?? radiusValue,
    };

    let cache = prev?.cache;
    let query = prev?.query;
    let sphereQuery = prev?.sphereQuery ?? null;

    if (!cache || !query || prev?.shapeKey !== shapeKey) {
      cache = createCpuTerrainCache(maxNodesValue, configValues);
      query = createTerrainQuery(cache);
      sphereQuery =
        projectionValue === "cubeSphere" ? createTerrainSphereQuery(cache) : null;
    }

    cache.updateConfig(configValues);

    return { cache, query, sphereQuery, shapeKey };
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
