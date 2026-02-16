import type { TaskRef } from "@hello-terrain/work";
import type {
  StorageBufferAttribute,
  StorageBufferNode,
  WebGPURenderer,
} from "three/webgpu";
import type { ShaderCallNodeInternal } from "three/src/nodes/TSL.js";
import type { Surface, LeafSet, QuadtreeState } from "../quadtree";
import type { ComputePipeline } from "../gpu/compute";
import type { createTileCompute } from "../gpu/tile";
import type { LeafStorageState, TerrainUniformsContext } from "../types";

export interface QuadtreeConfigState {
  state: QuadtreeState;
  surface: Surface;
}

export interface LeafGpuBufferState extends LeafStorageState {
  count: number;
}

export interface ElevationFieldContext {
  data: Float32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

export interface NormalFieldContext {
  data: Uint32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

/** Task refs for the standard terrain pipeline. */
export interface TerrainTasks {
  instanceId: TaskRef<string>;
  quadtreeConfig: TaskRef<QuadtreeConfigState>;
  quadtreeUpdate: TaskRef<LeafSet>;
  surface: TaskRef<Surface>;
  leafStorage: TaskRef<LeafStorageState>;
  leafGpuBuffer: TaskRef<LeafGpuBufferState>;
  createUniforms: TaskRef<TerrainUniformsContext>;
  updateUniforms: TaskRef<TerrainUniformsContext>;
  positionNode: TaskRef<ShaderCallNodeInternal>;
  createElevationFieldContext: TaskRef<ElevationFieldContext>;
  createTileNodes: TaskRef<ReturnType<typeof createTileCompute>>;
  createNormalFieldContext: TaskRef<NormalFieldContext>;
  elevationFieldStage: TaskRef<ComputePipeline>;
  normalFieldStage: TaskRef<ComputePipeline>;
  compileCompute: TaskRef<{
    execute: (renderer: WebGPURenderer, instanceCount: number) => void;
  }>;
  executeCompute: TaskRef<void | (() => void)>;
}
