import type {
  ElevationCallback,
  LodCriteria,
  TerrainGraph,
  TerrainQuery,
  TerrainRaycast,
  TerrainResidencyAnchor,
  TerrainSphereQuery,
  TerrainSurfaceQuery,
  TerrainTasks,
  Topology,
} from "@hello-terrain/three";
import type { Task } from "@hello-terrain/work";
import type { RootState, ThreeElements } from "@react-three/fiber";
import type { ReactNode } from "react";
import type { ShaderCallNodeInternal } from "three/src/nodes/TSL.js";
import type { Camera, WebGPURenderer } from "three/webgpu";

export type TerrainVector3Like = {
  x: number;
  y: number;
  z: number;
};

export type TerrainTask = Task<unknown, string, { renderer: WebGPURenderer }>;

export interface TerrainNodes {
  positionNode: ShaderCallNodeInternal | null;
}

export interface TerrainRuntime {
  query: TerrainQuery | null;
  /** Generic closed-surface query; `null` on flat surfaces. */
  surfaceQuery: TerrainSurfaceQuery | null;
  /** Cube-sphere query; `null` unless the topology uses the cubeSphere projection. */
  sphereQuery: TerrainSphereQuery | null;
  raycast: TerrainRaycast | null;
}

export interface TerrainHandle extends TerrainNodes {
  graph: TerrainGraph;
  tasks: TerrainTasks;
  runtime: TerrainRuntime;
  ready: boolean;
  topology?: Topology | null;
  /**
   * Override the camera used for quadtree updates. Prefer `culling.camera` on
   * `useTerrain()` or `<Terrain />` instead of calling this directly.
   */
  bindCamera?: (camera: Camera | undefined) => void;
}

/** Static terrain shape and material configuration. */
export interface TerrainShapeOptions {
  rootSize?: number;
  origin?: TerrainVector3Like;
  maxLevel?: number;
  maxNodes?: number;
  innerTileSegments?: number;
  skirtScale?: number;
  elevationScale?: number;
  radius?: number;
  elevation?: ElevationCallback;
  topology?: Topology | null;
  terrainFieldFilter?: "nearest" | "linear";
}

/** Camera-driven LOD and frustum culling inputs. */
export interface TerrainCullingOptions {
  /**
   * Camera for quadtree LOD and frustum culling. When omitted, the active R3F
   * canvas camera is used.
   */
  camera?: Camera;
  getCameraOrigin?: (state: RootState) => TerrainVector3Like;
  /** Minimum camera-origin movement before `cameraView` is updated. */
  originHysteresis?: number;
}

/** Residency anchors that keep tiles loaded off-screen. */
export interface TerrainResidencyOptions {
  getAnchors?: (state: RootState) => readonly TerrainResidencyAnchor[] | undefined;
  /** Minimum anchor movement before `residencyAnchors` is updated. */
  hysteresis?: number;
}

/** Which graph stages `run()` executes each frame. */
export interface TerrainPipelineOptions {
  /** Execute terrain field compute for dirty slots. Default `true`. */
  compute?: boolean;
  /** Trigger elevation/bounds readback after compute. Default `true`. */
  readback?: boolean;
  /** Upload the resident tile spatial index used by GPU samplers. Default `true`. */
  gpuSpatialIndex?: boolean;
}

export interface TerrainOptions extends TerrainShapeOptions {
  culling?: TerrainCullingOptions;
  residency?: TerrainResidencyOptions;
  lod?: LodCriteria;
  pipeline?: TerrainPipelineOptions;
  tasks?: readonly TerrainTask[];
}

export type TerrainPrimitiveProps = Omit<ThreeElements["primitive"], "object" | "children">;

export interface TerrainProps extends TerrainPrimitiveProps, TerrainOptions {
  terrain?: TerrainHandle;
  children: (nodes: TerrainNodes) => ReactNode;
}
