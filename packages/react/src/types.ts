import type {
  ElevationCallback,
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
   * Override the camera used for quadtree updates. Prefer the `camera` option on
   * `useTerrain()` or `<Terrain />` instead of calling this directly.
   */
  bindCamera?: (camera: Camera | undefined) => void;
}

export interface TerrainOptions {
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
  getCameraOrigin?: (state: RootState) => TerrainVector3Like;
  getResidencyAnchors?: (state: RootState) => readonly TerrainResidencyAnchor[] | undefined;
  residencyHysteresis?: number;
  cameraHysteresis?: number;
  /**
   * Optional camera for quadtree LOD and frustum culling. When omitted, the
   * active R3F canvas camera is used. Pass a separate camera to decouple the
   * render view from culling, for example in the frustum-culling example.
   */
  camera?: Camera;
  /**
   * Execute terrain field compute for dirty slots. Disable to freeze computed
   * field contents while still updating draw buffers and CPU visibility.
   */
  runCompute?: boolean;
  /**
   * Trigger elevation/bounds readback after compute. Ignored when
   * `runCompute` is false.
   */
  runReadback?: boolean;
  /** Upload the resident tile spatial index used by GPU samplers. */
  runGpuSpatialIndex?: boolean;
  tasks?: readonly TerrainTask[];
}

export type TerrainPrimitiveProps = Omit<ThreeElements["primitive"], "object" | "children">;

export interface TerrainProps extends TerrainPrimitiveProps, TerrainOptions {
  terrain?: TerrainHandle;
  children: (nodes: TerrainNodes) => ReactNode;
}
