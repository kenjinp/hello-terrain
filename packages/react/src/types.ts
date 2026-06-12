import type {
  ElevationCallback,
  TerrainGraph,
  TerrainQuery,
  TerrainRaycast,
  TerrainSphereQuery,
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
  stitchSeams?: boolean;
  elevationScale?: number;
  radius?: number;
  elevation?: ElevationCallback;
  topology?: Topology | null;
  terrainFieldFilter?: "nearest" | "linear";
  getCameraOrigin?: (state: RootState) => TerrainVector3Like;
  cameraHysteresis?: number;
  tasks?: readonly TerrainTask[];
}

export type TerrainPrimitiveProps = Omit<ThreeElements["primitive"], "object" | "children">;

export interface TerrainProps extends TerrainPrimitiveProps, TerrainOptions {
  terrain?: TerrainHandle;
  children: (nodes: TerrainNodes) => ReactNode;
}
