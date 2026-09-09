import {
    createTerrain,
    createFlatTopology,
    terrainGraph,
    terrainTasks,
    type TerrainGraph,
    type TerrainConfig,
} from '@hello-terrain/three';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { WebGPURenderer } from 'three/webgpu';
import type { TerrainHandle, TerrainOptions, TerrainRuntime } from './types';

/** React owns a runtime lease; production is the same as vanilla Three. */
export function useTerrain(options: TerrainOptions = {}): TerrainHandle {
    const renderer = useThree((state) => state.gl) as unknown as WebGPURenderer;
    const topology = useMemo(
        () =>
            options.topology ??
            createFlatTopology({
                rootSize: options.rootSize ?? 256,
                origin: {
                    x: options.origin?.x ?? 0,
                    y: options.origin?.y ?? 0,
                    z: options.origin?.z ?? 0,
                },
            }),
        [options.topology, options.rootSize, options.origin?.x, options.origin?.y, options.origin?.z]
    );
    const readback = options.queries?.readback,
        maxRetainedSnapshots = options.queries?.maxRetainedSnapshots;
    const controller = useMemo(
        () => createTerrain({ renderer, queries: { readback, maxRetainedSnapshots } }),
        [renderer, readback, maxRetainedSnapshots]
    );
    const status = useSyncExternalStore(
        controller.subscribe,
        controller.getStatus,
        controller.getStatus
    );
    const lifecycle = useMemo(() => ({ controller, generation: 0 }), [controller]);
    const defaults = useMemo(() => controller.getConfig(), [controller]);
    const appliedProps = useRef<{
        controller: typeof controller;
        config: Partial<TerrainConfig>;
    } | null>(null);
    useEffect(() => {
        const generation = ++lifecycle.generation;
        return () => {
            queueMicrotask(() => {
                if (lifecycle.generation === generation) void controller.dispose();
            });
        };
    }, [controller, lifecycle]);
    useLayoutEffect(() => {
        const config: Partial<TerrainConfig> = { topology };
        for (const key of [
            'maxLevel',
            'maxNodes',
            'innerTileSegments',
            'skirtScale',
            'elevationScale',
            'elevation',
            'elevationRange',
            'terrainFieldFilter',
            'terrainFieldFormat',
            'lod',
        ] as const) {
            const value = options[key] ?? defaults[key];
            Object.assign(config, { [key]: value });
        }
        const previous =
            appliedProps.current?.controller === controller ? appliedProps.current.config : null;
        const patch: Partial<TerrainConfig> = {};
        for (const key of Object.keys(config) as (keyof TerrainConfig)[]) {
            const a = previous?.[key],
                b = config[key];
            const same =
                key === 'lod' || key === 'elevationRange'
                    ? JSON.stringify(a) === JSON.stringify(b)
                    : a === b;
            if (!same) Object.assign(patch, { [key]: b });
        }
        appliedProps.current = { controller, config };
        if (Object.keys(patch).length) controller.configure(patch);
    }); // resolve/equality make equivalent data props a no-op after every commit.

    const latest = useRef(options);
    latest.current = options;
    const viewBinding = useRef<TerrainHandle['binding']>(null);
    const submitted = useRef<{
        controller: typeof controller;
        position: number[];
        projectionFactor?: number;
        edit: number;
    } | null>(null);
    useFrame((state) => {
        if (controller.getStatus().productionPending) return;
        const custom = latest.current.getCameraOrigin?.(state);
        const view = custom
            ? { position: [custom.x, custom.y, custom.z] as [number, number, number] }
            : viewBinding.current
              ? viewBinding.current.viewFromCamera(state.camera, state.size.height)
              : {
                    position: state.camera.position.toArray(),
                    projectionFactor:
                        (state.size.height * Math.abs(state.camera.projectionMatrix.elements[5]!)) /
                        2,
                };
        const previous = submitted.current,
            edit = controller.getStatus().acceptedEditVersion;
        const threshold = Math.max(0, latest.current.cameraHysteresis ?? 0);
        if (
            previous?.controller === controller &&
            previous.edit === edit &&
            previous.projectionFactor === view.projectionFactor &&
            Math.hypot(...view.position.map((value, i) => value - previous.position[i]!)) < threshold
        )
            return;
        submitted.current = { controller, ...view, edit };
        void controller.update(view);
    });
    // Inspection only: the simple API never needs graph tasks. Kept for existing
    // debug panels; edits use configure/invalidate methods on the controller.
    const graph = useMemo(() => {
        const empty = terrainGraph();
        return new Proxy(empty, {
            get(_target, key) {
                if (key === 'on') return controller.onGraphEvent;
                if (
                    key === 'set' ||
                    key === 'reset' ||
                    key === 'add' ||
                    key === 'run' ||
                    key === 'dispose'
                )
                    return () => {
                        throw new Error(
                            'Runtime owns the graph; use terrain.controller.configure/update/dispose'
                        );
                    };
                const current = controller.getRender()?.graph ?? empty;
                const value = Reflect.get(current, key);
                return typeof value === 'function' ? value.bind(current) : value;
            },
        }) as TerrainGraph;
    }, [controller]);
    const runtime = useMemo<TerrainRuntime>(
        () => ({
            get query() {
                return controller.getLegacyQueries()?.query ?? null;
            },
            get surfaceQuery() {
                return controller.getLegacyQueries()?.surfaceQuery ?? null;
            },
            get sphereQuery() {
                return controller.getLegacyQueries()?.sphereQuery ?? null;
            },
            get raycast() {
                return controller.getLegacyQueries()?.raycast ?? null;
            },
        }),
        [controller]
    );
    return useMemo(
        () => ({
            graph,
            tasks: terrainTasks,
            runtime,
            controller,
            status,
            get binding() {
                return viewBinding.current;
            },
            set binding(value) {
                viewBinding.current = value;
            },
            topology,
            ready: status.renderRevision !== null,
            positionNode: controller.getRender()?.positionNode ?? null,
            materialContext: controller.getRender()?.materialContext,
        }),
        [graph, runtime, controller, status, topology]
    );
}
