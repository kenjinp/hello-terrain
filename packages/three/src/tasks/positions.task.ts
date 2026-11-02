import { task } from "@hello-terrain/work";
import { Fn, If, bitcast, int, uint, vertexIndex } from "three/tsl";
import { loadTileField } from "../gpu/tileFieldStorage";
import { createTextureFieldContextTask } from "./texture-field.task";
import { textureRender } from "./params";
import { tileIndex } from "../tsl/varyings";
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
 * per vertex and assigns the world-space normal to normalLocal.
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
  const textureContext = get(createTextureFieldContextTask);
  const holes = get(textureRender).holes ?? "discard";
  return work(() => {
    const position = topology.projection.gpu.renderVertexPosition({
      leafStorage, uniforms: terrainUniforms, terrainFieldStorage,
      tileBoundsNode: tileBoundsContext.node,
    });
    if (!textureContext || holes !== "collapse") return position;
    const field = textureContext.storage;
    return Fn(() => {
      const result = position.toVar();
      const vertex = int(vertexIndex), edge = int(field.edgeVertexCount);
      const control = loadTileField(field, vertex.mod(edge), vertex.div(edge), tileIndex()).r;
      If(control.bitAnd(4).notEqual(0), () => {
        // A runtime quiet-NaN payload: WGSL rejects a constant non-finite f32 expression.
        result.x.assign(bitcast(control.bitOr(uint(0x7fc00000)), "float"));
      });
      return result;
    })();
  });
}).displayName("positionNodeTask");
