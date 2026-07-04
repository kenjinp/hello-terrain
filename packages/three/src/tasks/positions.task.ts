import { task } from "@hello-terrain/work";
import { createTerrainFieldTextureTask } from "./terrain-field.task";
import { tileBoundsContextTask } from "./tile-bounds.task";
import { leafStorageTask, topologyTask } from "./quadtree.task";
import { updateUniformsTask } from "./uniforms/uniforms.task";

/**
 * Builds the TSL position node for the terrain shader.
 *
 * Depends on leafStorageTask (buffer objects), updateUniformsTask
 * (uniform nodes), createTerrainFieldTextureTask (combined terrain field storage),
 * and tileBoundsContextTask (per-tile pack bounds for denormalization).
 *
 * The position node reads packed terrain samples (normalized height + normal)
 * per-vertex and assigns them to the vNormal
 * varying for use in the fragment shader.
 *
 * These only change when their GPU resources are recreated
 * (e.g. buffer resize), so this task stays cached during normal quadtree
 * updates — no unnecessary shader rebuilds.
 */
export const positionNodeTask = task((get, work) => {
  const leafStorage = get(leafStorageTask);
  const terrainUniforms = get(updateUniformsTask);
  const terrainFieldStorage = get(createTerrainFieldTextureTask);
  const tileBoundsContext = get(tileBoundsContextTask);
  const topology = get(topologyTask);
  return work(() =>
    topology.projection.gpu.renderVertexPosition({
      leafStorage,
      uniforms: terrainUniforms,
      terrainFieldStorage,
      tileBoundsNode: tileBoundsContext.node,
    }),
  );
}).displayName("positionNodeTask");
