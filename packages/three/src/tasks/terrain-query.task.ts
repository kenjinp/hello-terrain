import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import { createCpuTerrainCache } from "../query/cpu-terrain-cache";
import { createElevationFieldContextTask } from "./elevation-field.task";
import type { TerrainQueryContext } from "./graph.types";
import {
  elevationScale,
  innerTileSegments,
  maxLevel,
  maxNodes,
  origin,
  radius,
  rootSize,
} from "./params";
import {
  dirtyVisibleSlotBufferTask,
  leafGpuBufferTask,
  residentLeafSetTask,
  topologyTask,
} from "./quadtree.task";
import { tileBoundsReductionTask } from "./tile-bounds.task";
import { createTerrainQueryShapeKey } from "./cache-key";

export const terrainQueryTask = task((get, work) => {
  const maxNodesValue = get(maxNodes);
  const innerTileSegmentsValue = get(innerTileSegments);
  const maxLevelValue = get(maxLevel);
  const rootSizeValue = get(rootSize);
  const originValue = get(origin);
  const elevationScaleValue = get(elevationScale);
  const radiusValue = get(radius);
  const topologyValue = get(topologyTask);
  const projection = topologyValue.projection;

  return work((prev?: TerrainQueryContext): TerrainQueryContext => {
    const shapeKey = createTerrainQueryShapeKey(
      topologyValue,
      maxNodesValue,
      innerTileSegmentsValue,
      maxLevelValue,
    );
    const resolvedRadius = projection.radius ?? radiusValue;
    const configValues = {
      rootSize: rootSizeValue,
      originX: originValue.x,
      originY: originValue.y,
      originZ: originValue.z,
      innerTileSegments: innerTileSegmentsValue,
      elevationScale: elevationScaleValue,
      maxLevel: maxLevelValue,
      radius: resolvedRadius,
      baseU: projection.baseResolution?.u ?? 1,
      baseV: projection.baseResolution?.v ?? 1,
    };

    let cache = prev?.cache;
    let query = prev?.query;
    let surfaceQuery = prev?.surfaceQuery ?? null;
    let sphereQuery = prev?.sphereQuery ?? null;

    if (!cache || !query || prev?.shapeKey !== shapeKey) {
      prev?.cache?.dispose();
      cache = createCpuTerrainCache(maxNodesValue, configValues, projection.cpu.createSurfaceOps());
      const runtime = projection.cpu.createRuntimeQueries(cache);
      query = runtime.query;
      surfaceQuery = runtime.surfaceQuery;
      sphereQuery = runtime.sphereQuery;
    } else if (prev?.projection !== projection) {
      cache.setSurfaceOps(projection.cpu.createSurfaceOps());
      const runtime = projection.cpu.createRuntimeQueries(cache);
      query = runtime.query;
      surfaceQuery = runtime.surfaceQuery;
      sphereQuery = runtime.sphereQuery;
    }

    cache.updateConfig(configValues);

    return { cache, query, surfaceQuery, sphereQuery, shapeKey, projection };
  });
}).displayName("terrainQueryTask");

export const terrainReadbackTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const boundsContext = get(tileBoundsReductionTask);
    const elevationFieldContext = get(createElevationFieldContextTask);
    const residentLeafSet = get(residentLeafSetTask);
    const leafState = get(leafGpuBufferTask);
    const dirtyVisibleSlots = get(dirtyVisibleSlotBufferTask);
    const { cache } = get(terrainQueryTask);

    return work((): void => {
      if (!resources?.renderer) return;

      cache.triggerReadback(
        resources.renderer,
        elevationFieldContext.attribute,
        residentLeafSet.index,
        boundsContext.attribute,
        leafState.activeSlotCount,
        dirtyVisibleSlots.data,
        dirtyVisibleSlots.count,
      );
    });
  },
)
  .displayName("terrainReadbackTask")
  .lane("gpu");
