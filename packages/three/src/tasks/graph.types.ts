import type { Graph, TaskRef } from "@hello-terrain/work";
import type {
  StorageBufferAttribute,
  StorageBufferNode,
  WebGPURenderer,
} from "three/webgpu";
import type { ShaderCallNodeInternal } from "three/src/nodes/TSL.js";
import type { Topology, LeafSet, QuadtreeState } from "../quadtree";
import type { ComputePipeline } from "../gpu/compute";
import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
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
import type {
  LeafStorageState,
  TerrainUniformsContext,
  VisibleSlotStorageState,
} from "../types";
import type {
  SlotIndexBufferState,
  TileIncrementalTelemetryState,
  VisibleLeafSetState,
} from "./quadtree.task";

export interface QuadtreeConfigState {
  state: QuadtreeState;
  topology: Topology;
}

export interface LeafGpuBufferState extends LeafStorageState {
  count: number;
  activeSlotCount: number;
  visibleSlotStorage: VisibleSlotStorageState;
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
  /** Buffer-shape identity (maxNodes/segments/maxLevel/topology cache key); change recreates the cache. */
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
  tileVisibility: TaskRef<TileIncrementalTelemetryState["visibility"]>;
  tileResidency: TaskRef<TileIncrementalTelemetryState["residency"]>;
  terrainFieldContentEpoch: TaskRef<number>;
  visibleLeafSet: TaskRef<VisibleLeafSetState>;
  residentLeafSet: TaskRef<VisibleLeafSetState>;
  tileSlotUpdate: TaskRef<TileIncrementalTelemetryState>;
  topology: TaskRef<Topology>;
  leafStorage: TaskRef<LeafStorageState>;
  visibleSlotStorage: TaskRef<VisibleSlotStorageState>;
  dirtyVisibleSlotStorage: TaskRef<VisibleSlotStorageState>;
  dirtyVisibleSlotBuffer: TaskRef<SlotIndexBufferState>;
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
