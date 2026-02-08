import { task } from "@hello-terrain/work";
import { createTileWorldPosition } from "../nodes/worldPosition";
import { createHeightmapContextTask } from "./heightmap.task";
import { createNormalmapContextTask } from "./normalmap.task";
import { leafStorageTask } from "./quadtree.task";
import { createUniformsTask } from "./uniforms/uniforms.task";

/**
 * Builds the TSL position node for the terrain shader.
 *
 * Depends on leafStorageTask (buffer objects), createUniformsTask
 * (uniform nodes), createHeightmapContextTask (heightmap storage),
 * and createNormalmapContextTask (normalmap storage).
 *
 * The position node also reads normals from the normalmap buffer
 * per-vertex (using vertexIndex) and assigns them to the vNormal
 * varying for use in the fragment shader.
 *
 * These only change when their GPU resources are recreated
 * (e.g. buffer resize), so this task stays cached during normal quadtree
 * updates — no unnecessary shader rebuilds.
 */
export const positionNodeTask = task((get, work) => {
  const leafStorage = get(leafStorageTask);
  const terrainUniforms = get(createUniformsTask);
  const heightmapContext = get(createHeightmapContextTask);
  const normalmapContext = get(createNormalmapContextTask);
  return work(() =>
    createTileWorldPosition(
      leafStorage,
      terrainUniforms,
      heightmapContext.node,
      normalmapContext.node,
    ),
  );
}).displayName("terrainVertextPositionNodeTask");
