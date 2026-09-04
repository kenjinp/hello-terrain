import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import { createCpuTerrainCache } from "../query/cpu-terrain-cache";
import { readbackNow, shouldScheduleReadback } from "../query/readback-schedule";
import { createElevationFieldContextTask } from "./elevation-field.task";
import type { TerrainQueryContext, TerrainReadbackState } from "./graph.types";
import {
  elevationScale,
  innerTileSegments,
  maxLevel,
  maxNodes,
  origin,
  radius,
  rootSize,
  terrainReadbackEnabled,
  terrainReadbackIntervalMs,
} from "./params";
import { leafGpuBufferTask, quadtreeConfigTask, topologyTask } from "./quadtree.task";
import { tileBoundsReductionTask } from "./compute.task";

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
    const shapeKey = `${maxNodesValue}:${innerTileSegmentsValue}:${projection.kind}`;
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

/**
 * Schedules the GPU→CPU elevation/bounds readback that feeds `TerrainQuery`,
 * `TerrainRaycast`, and the surface-relative LOD elevation ranges.
 *
 * Gated by `terrainReadbackEnabled` / `terrainReadbackIntervalMs`. The
 * last-scheduled timestamp lives in the task's own returned state (`prev`), so
 * multiple terrain instances never share throttle state.
 *
 * `cache("none")`: the gate depends on wall-clock time and on the in-flight
 * `readbackPending` flag, neither of which is a graph input. With memoization a
 * readback skipped because it was throttled or still pending would not be
 * retried until some upstream dependency changed, so the final GPU state could
 * go unread indefinitely. The body is cheap when nothing needs scheduling.
 */
export const terrainReadbackTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const boundsContext = get(tileBoundsReductionTask);
    const elevationFieldContext = get(createElevationFieldContextTask);
    const quadtreeConfig = get(quadtreeConfigTask);
    const leafState = get(leafGpuBufferTask);
    const { cache } = get(terrainQueryTask);
    const enabled = get(terrainReadbackEnabled);
    const intervalMs = get(terrainReadbackIntervalMs);

    return work((prev?: TerrainReadbackState): TerrainReadbackState => {
      const state = prev ?? { lastScheduledAt: -Infinity };
      if (!resources?.renderer) return state;

      const now = readbackNow();
      if (!shouldScheduleReadback(now, state.lastScheduledAt, intervalMs, enabled)) {
        return state;
      }

      const scheduled = cache.triggerReadback(
        resources.renderer,
        elevationFieldContext.attribute,
        quadtreeConfig.state.leafIndex,
        boundsContext.attribute,
        leafState.count,
      );
      if (scheduled) state.lastScheduledAt = now;
      return state;
    });
  },
)
  .displayName("terrainReadbackTask")
  .cache("none")
  .lane("gpu");
