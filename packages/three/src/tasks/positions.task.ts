import { task } from "@hello-terrain/work";
import { createTileWorldPosition } from "../gpu/worldPosition";
import { createTerrainFieldTextureTask } from "./terrain-field.task";
import { innerTileSegments, stitchSeams } from "./params";
import { leafStorageTask, topologyTask } from "./quadtree.task";
import { updateUniformsTask } from "./uniforms/uniforms.task";

/**
 * Builds the TSL position node for the terrain shader.
 *
 * Depends on leafStorageTask (buffer objects), updateUniformsTask
 * (uniform nodes), and createTerrainFieldTextureTask (combined terrain field storage).
 *
 * The position node reads packed terrain samples (height + normal.xz)
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
  const topology = get(topologyTask);
  const stitch = get(stitchSeams);
  const innerSegments = get(innerTileSegments);
  return work(() =>
    createTileWorldPosition(
      leafStorage,
      terrainUniforms,
      terrainFieldStorage,
      topology.projection ?? "flat",
      { stitchSeams: stitch, innerSegments },
    ),
  );
}).displayName("positionNodeTask");
