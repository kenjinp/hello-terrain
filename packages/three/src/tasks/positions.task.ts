import { task } from "@hello-terrain/work";
import { createTileWorldPosition } from "../gpu/worldPosition";
import { createElevationFieldContextTask } from "./elevation-field.task";
import { createNormalFieldContextTask } from "./normal-field.task";
import { leafStorageTask } from "./quadtree.task";
import { createUniformsTask } from "./uniforms/uniforms.task";

/**
 * Builds the TSL position node for the terrain shader.
 *
 * Depends on leafStorageTask (buffer objects), createUniformsTask
 * (uniform nodes), createElevationFieldContextTask (elevation field storage),
 * and createNormalFieldContextTask (normal field storage).
 *
 * The position node also reads normals from the normal field buffer
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
  const elevationFieldContext = get(createElevationFieldContextTask);
  const normalFieldContext = get(createNormalFieldContextTask);
  return work(() =>
    createTileWorldPosition(
      leafStorage,
      terrainUniforms,
      elevationFieldContext.node,
      normalFieldContext.node,
    ),
  );
}).displayName("positionNodeTask");
