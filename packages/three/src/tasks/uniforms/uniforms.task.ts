import { task } from "@hello-terrain/work";
import { createTerrainUniforms } from "../../gpu/uniforms";
import type { TerrainUniformsParams } from "../../types";
import { instanceIdTask } from "../instanceId.task";
import { elevationScale, innerTileSegments, origin, radius, rootSize, skirtScale } from "../params";
import { topologyTask } from "../quadtree.task";
import { resolveTerrainWorldConfig } from "../world-config";

/**
 * Creates the terrain uniform nodes once. Downstream tasks capture
 * references to these nodes in shader graphs, so the same instances
 * must persist across runs.
 *
 * World config (`rootSize`, `origin`, `radius`) is owned by the topology;
 * the params are only a fallback (see `resolveTerrainWorldConfig`).
 */
export const createUniformsTask = task((get, work) => {
  const world = resolveTerrainWorldConfig(get(topologyTask), {
    rootSize: get(rootSize),
    origin: get(origin),
    radius: get(radius),
  });
  const uniformParams: TerrainUniformsParams = {
    rootOrigin: world.origin,
    rootSize: world.rootSize,
    innerTileSegments: get(innerTileSegments),
    skirtScale: get(skirtScale),
    elevationScale: get(elevationScale),
    radius: world.radius,
    instanceId: get(instanceIdTask),
  };
  return work(() => createTerrainUniforms(uniformParams));
})
  .displayName("createUniformsTask")
  .cache("once");

/**
 * Updates the terrain uniform values each run. Reads the persisted uniform
 * nodes from createUniformsTask and writes the latest values, with the
 * topology as the source of truth for `uRootSize` / `uRootOrigin` / `uRadius`.
 */
export const updateUniformsTask = task((get, work) => {
  const terrainUniformsContext = get(createUniformsTask);
  const world = resolveTerrainWorldConfig(get(topologyTask), {
    rootSize: get(rootSize),
    origin: get(origin),
    radius: get(radius),
  });
  const innerTileSegmentsVal = get(innerTileSegments);
  const skirtScaleVal = get(skirtScale);
  const elevationScaleVal = get(elevationScale);

  return work(() => {
    terrainUniformsContext.uRootSize.value = world.rootSize;
    // Mutate the uniform's own Vector3 in place: sharing a module-scope scratch
    // vector would alias `uRootOrigin.value` across terrain instances.
    terrainUniformsContext.uRootOrigin.value.set(world.origin.x, world.origin.y, world.origin.z);
    terrainUniformsContext.uInnerTileSegments.value = innerTileSegmentsVal;
    terrainUniformsContext.uSkirtScale.value = skirtScaleVal;
    terrainUniformsContext.uElevationScale.value = elevationScaleVal;
    terrainUniformsContext.uRadius.value = world.radius;

    return terrainUniformsContext;
  });
}).displayName("updateUniformsTask");
