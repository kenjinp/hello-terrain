import type {
  ElevationCallback,
  TerrainGraph,
  TerrainQuery,
  TerrainRaycast,
  TerrainSphereQuery,
  TerrainSurfaceQuery,
  TerrainTasks,
  Topology,
} from "@hello-terrain/three";
import type { Task } from "@hello-terrain/work";
import type { RootState, ThreeElements } from "@react-three/fiber";
import type { ReactNode } from "react";
import type { ShaderCallNodeInternal } from "three/src/nodes/TSL.js";
import type { WebGPURenderer } from "three/webgpu";

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
  /**
   * Enable the GPU→CPU elevation readback that powers `runtime.query`,
   * `runtime.raycast`, and surface-relative LOD. Maps to the core
   * `terrainReadbackEnabled` param (default `true`).
   */
  terrainReadback?: boolean;
  /**
   * Minimum milliseconds between scheduled readbacks (`0` = every frame the
   * quadtree changes). Maps to the core `terrainReadbackIntervalMs` param.
   */
  terrainReadbackIntervalMs?: number;
  getCameraOrigin?: (state: RootState) => TerrainVector3Like;
  cameraHysteresis?: number;
  tasks?: readonly TerrainTask[];
}

export type TerrainPrimitiveProps = Omit<ThreeElements["primitive"], "object" | "children">;

export type TerrainRenderProps = {
  children: (nodes: TerrainNodes) => ReactNode;
};

/** Props when a pre-built terrain handle is supplied via `useTerrain`. */
export type TerrainPropsWithHandle = TerrainPrimitiveProps &
  TerrainRenderProps & {
    terrain: TerrainHandle;
    innerTileSegments?: number;
    maxNodes?: number;
  };

/** Props when `<Terrain>` should construct the handle internally. */
export type TerrainPropsWithoutHandle = TerrainPrimitiveProps &
  TerrainOptions &
  TerrainRenderProps & {
    terrain?: undefined;
  };

export type TerrainProps = TerrainPropsWithHandle | TerrainPropsWithoutHandle;
