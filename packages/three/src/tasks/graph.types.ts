import type { Graph, TaskRef } from "@hello-terrain/work";
import type {
  StorageBufferAttribute,
  StorageBufferNode,
  WebGPURenderer,
} from "three/webgpu";
import type { ShaderCallNodeInternal } from "three/src/nodes/TSL.js";
import type { Topology, LeafSet, QuadtreeState } from "../quadtree";
import type { CompiledComputePipeline, ComputePipeline } from "../gpu/compute";
import type { TileFieldStorage } from "../gpu/tileFieldStorage";
import type { createTileCompute } from "../gpu/tile";
import type { CpuTerrainCache } from "../query/cpu-terrain-cache";
import type { SurfaceProjection } from "../projection/types";
import type {
  GpuSpatialIndexContext,
  TerrainQuery,
  TerrainRaycast,
  TerrainSampler,
  TerrainSphereQuery,
  TerrainSurfaceQuery,
} from "../query/types";
import type { TileBoundsContext } from "./tile-bounds.task";
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import type { TextureFieldContext } from "./texture-field.task";
import type { TerrainTextureNodes } from "../texture/texture-nodes";

export interface QuadtreeConfigState {
  state: QuadtreeState;
  topology: Topology;
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
  /** Generic closed-surface query; `null` on flat surfaces. */
  surfaceQuery: TerrainSurfaceQuery | null;
  /** Cube-sphere query; `null` unless the topology uses the cubeSphere projection. */
  sphereQuery: TerrainSphereQuery | null;
  /** Buffer-shape identity (maxNodes/segments/projection kind); change recreates the cache. */
  shapeKey: string;
  /**
   * The projection these queries close over. Recreated on any geometry change
   * (e.g. cube-sphere radius, torus major/minor); an identity change rebuilds
   * the surface ops + queries so picks/markers stay in sync.
   */
  projection: SurfaceProjection;
}

/** Task refs for the standard terrain pipeline. */
export interface TerrainTasks {
  instanceId: TaskRef<string>;
  quadtreeConfig: TaskRef<QuadtreeConfigState>;
  quadtreeUpdate: TaskRef<LeafSet>;
  topology: TaskRef<Topology>;
  leafStorage: TaskRef<LeafStorageState>;
  leafGpuBuffer: TaskRef<LeafGpuBufferState>;
  gpuSpatialIndexStorage: TaskRef<GpuSpatialIndexContext>;
  gpuSpatialIndexUpload: TaskRef<GpuSpatialIndexContext>;
  createUniforms: TaskRef<TerrainUniformsContext>;
  updateUniforms: TaskRef<TerrainUniformsContext>;
  positionNode: TaskRef<ShaderCallNodeInternal>;
  createElevationFieldContext: TaskRef<ElevationFieldContext>;
  createTileNodes: TaskRef<ReturnType<typeof createTileCompute>>;
  createTerrainFieldTexture: TaskRef<TileFieldStorage>;
  createTerrainSampler: TaskRef<TerrainSampler>;
  elevationFieldStage: TaskRef<ComputePipeline>;
  terrainFieldStage: TaskRef<ComputePipeline>;
  createTextureFieldContext: TaskRef<TextureFieldContext | null>;
  textureFieldStage: TaskRef<ComputePipeline>;
  textureNodes: TaskRef<TerrainTextureNodes | null>;
  compileCompute: TaskRef<CompiledComputePipeline>;
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
