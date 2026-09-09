import type {
    ElevationCallback,
    TerrainGraph,
    LegacyTerrainQuery,
    TerrainRaycast,
    TerrainSphereQuery,
    TerrainSurfaceQuery,
    TerrainTasks,
    Topology,
    Terrain as TerrainController,
    TerrainBinding,
    TerrainConfig,
    TerrainRuntimeStatus,
    CreateTerrainOptions,
    TerrainMaterialContext,
} from '@hello-terrain/three';
import type { Task } from '@hello-terrain/work';
import type { RootState, ThreeElements } from '@react-three/fiber';
import type { ReactNode } from 'react';
import type { ShaderCallNodeInternal } from 'three/src/nodes/TSL.js';
import type { WebGPURenderer } from 'three/webgpu';

export type TerrainVector3Like = {
    x: number;
    y: number;
    z: number;
};

export type TerrainTask = Task<unknown, string, { renderer: WebGPURenderer }>;

export interface TerrainNodes {
    positionNode: ShaderCallNodeInternal | null;
    materialContext?: TerrainMaterialContext;
}

export interface TerrainRuntime {
    query: LegacyTerrainQuery | null;
    /** Generic closed-surface query; `null` on flat surfaces. */
    surfaceQuery: TerrainSurfaceQuery | null;
    /** Cube-sphere query; `null` unless the topology uses the cubeSphere projection. */
    sphereQuery: TerrainSphereQuery | null;
    raycast: TerrainRaycast | null;
}

export interface TerrainHandle extends TerrainNodes {
    controller: TerrainController;
    binding: TerrainBinding | null;
    status: Readonly<TerrainRuntimeStatus>;
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
    elevation?: ElevationCallback;
    topology?: Topology | null;
    terrainFieldFilter?: 'nearest' | 'linear';
    terrainFieldFormat?: TerrainConfig['terrainFieldFormat'];
    getCameraOrigin?: (state: RootState) => TerrainVector3Like;
    cameraHysteresis?: number;
    elevationRange?: TerrainConfig['elevationRange'];
    lod?: TerrainConfig['lod'];
    queries?: CreateTerrainOptions['queries'];
}

export type TerrainPrimitiveProps = Omit<ThreeElements['primitive'], 'object' | 'children'>;

export type TerrainRenderProps = {
    children: (nodes: TerrainNodes) => ReactNode;
};

/** Props when a pre-built terrain handle is supplied via `useTerrain`. */
export type TerrainPropsWithHandle = TerrainPrimitiveProps &
    TerrainRenderProps & {
        terrain: TerrainHandle;
    };

/** Props when `<Terrain>` should construct the handle internally. */
export type TerrainPropsWithoutHandle = TerrainPrimitiveProps &
    TerrainOptions &
    TerrainRenderProps & {
        terrain?: undefined;
    };

export type TerrainProps = TerrainPropsWithHandle | TerrainPropsWithoutHandle;
