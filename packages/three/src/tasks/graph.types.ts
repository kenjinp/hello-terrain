import type { TaskRef } from "@hello-terrain/work";
import type { ShaderCallNodeInternal } from "three/src/nodes/TSL.js";
import type { LeafStorageState } from "./quadtree.task";
import type { TerrainUniformsContext } from "./uniforms/terrainUniforms";

/** Task refs for the standard terrain pipeline. */
export interface TerrainTasks {
  instanceId: TaskRef<string>;
  quadtreeConfig: TaskRef<any>;
  quadtreeUpdate: TaskRef<any>;
  leafStorage: TaskRef<LeafStorageState>;
  leafGpuBuffer: TaskRef<any>;
  createUniforms: TaskRef<TerrainUniformsContext>;
  updateUniforms: TaskRef<TerrainUniformsContext>;
  positionNode: TaskRef<ShaderCallNodeInternal>;
}
