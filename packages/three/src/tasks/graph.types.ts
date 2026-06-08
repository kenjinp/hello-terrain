import type { Graph, TaskRef } from "@hello-terrain/work";
import type {
  StorageBufferAttribute,
  StorageBufferNode,
  WebGPURenderer,
} from "three/webgpu";
import type { ShaderCallNodeInternal } from "three/src/nodes/TSL.js";
import type { Surface, LeafSet, QuadtreeState } from "../quadtree";
import type { ComputePipeline } from "../gpu/compute";
import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
import type { createTileCompute } from "../gpu/tile";
import type { CpuTerrainCache } from "../query/cpu-terrain-cache";
import type {
  GpuSpatialIndexContext,
  TerrainQuery,
  TerrainRaycast,
  TerrainSampler,
  TerrainSphereQuery,
} from "../query/types";
import type { TileBoundsContext } from "./tile-bounds.task";
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

export interface TerrainQueryContext {
  cache: CpuTerrainCache;
  query: TerrainQuery;
  /** Cube-sphere query; `null` unless the surface uses the cubeSphere projection. */
  sphereQuery: TerrainSphereQuery | null;
  shapeKey: string;
}

/** Task refs for the standard terrain pipeline. */
export interface TerrainTasks {
  instanceId: TaskRef<string>;
  quadtreeConfig: TaskRef<QuadtreeConfigState>;
  quadtreeUpdate: TaskRef<LeafSet>;
  surface: TaskRef<Surface>;
  leafStorage: TaskRef<LeafStorageState>;
  leafGpuBuffer: TaskRef<LeafGpuBufferState>;
  gpuSpatialIndexStorage: TaskRef<GpuSpatialIndexContext>;
  gpuSpatialIndexUpload: TaskRef<GpuSpatialIndexContext>;
  createUniforms: TaskRef<TerrainUniformsContext>;
  updateUniforms: TaskRef<TerrainUniformsContext>;
  positionNode: TaskRef<ShaderCallNodeInternal>;
  createElevationFieldContext: TaskRef<ElevationFieldContext>;
  createTileNodes: TaskRef<ReturnType<typeof createTileCompute>>;
  createTerrainFieldTexture: TaskRef<TerrainFieldStorage>;
  createTerrainSampler: TaskRef<TerrainSampler>;
  elevationFieldStage: TaskRef<ComputePipeline>;
  terrainFieldStage: TaskRef<ComputePipeline>;
  compileCompute: TaskRef<{
    execute: (renderer: WebGPURenderer, instanceCount: number) => void;
  }>;
  executeCompute: TaskRef<void | (() => void)>;
  tileBoundsContext: TaskRef<TileBoundsContext & { kernel: unknown }>;
  tileBoundsReduction: TaskRef<TileBoundsContext>;
  terrainQuery: TaskRef<TerrainQueryContext>;
  terrainReadback: TaskRef<void>;
  terrainRaycast: TaskRef<TerrainRaycast>;
}

export type TerrainGraph = Graph<
  string,
  {
    renderer: WebGPURenderer;
  }
>;
