import { float } from 'three/tsl';
import type { GraphEventCallback } from '@hello-terrain/work';
import type { WebGPURenderer, BufferGeometry, BufferAttribute } from 'three/webgpu';
import type { ShaderCallNodeInternal } from 'three/src/nodes/TSL.js';
import { createFlatTopology, type Topology } from '../quadtree';
import { terrainGraph, terrainTasks } from '../tasks/graph';
import type { TerrainGraph } from '../tasks/graph.types';
import * as params from '../tasks/params';
import type { ElevationCallback } from '../tsl/elevation';
import { createTerrainRuntime, type TerrainBackend, type TerrainSnapshotData, type TerrainView } from './runtime';
import type { RuntimeQueries } from '../projection/types';
import type { TerrainRaycast } from '../query/types';
import { createTerrainRaycast } from '../query/terrain-raycast';
import { createTerrainMaterialContext, type TerrainMaterialContext } from '../tsl/terrainMaterial';

export interface TerrainConfig {
    topology: Topology;
    elevation: ElevationCallback;
    elevationRange: { min: number; max: number };
    elevationScale: number;
    innerTileSegments: number;
    maxNodes: number;
    maxLevel: number;
    skirtScale: number;
    terrainFieldFilter: 'linear' | 'nearest';
    terrainFieldFormat: 'rgba16float' | 'rgba32float';
    lod: { mode: 'distance'; distanceFactor: number } | { mode: 'screen'; targetPixels: number };
}

export interface CreateTerrainOptions extends Partial<TerrainConfig> {
    renderer: WebGPURenderer;
    queries?: { readback?: 'on-change' | 'manual' | 'disabled'; maxRetainedSnapshots?: number };
}

export interface TerrainRender {
    readonly graph: TerrainGraph;
    readonly config: TerrainConfig;
    readonly count: number;
    readonly positionNode: ShaderCallNodeInternal;
    readonly materialContext: TerrainMaterialContext;
}

function resolve(config: TerrainConfig): TerrainConfig {
    for (const key of ['innerTileSegments', 'maxNodes', 'maxLevel'] as const) {
        if (!Number.isInteger(config[key]) || config[key] < (key === 'maxLevel' ? 0 : 1))
            throw new Error(`Invalid ${key}`);
    }
    if (config.maxLevel > 24)
        throw new Error('maxLevel exceeds the supported integer tile range (24)');
    if (config.maxNodes < config.topology.maxRootCount)
        throw new Error('maxNodes cannot hold required topology roots');
    if (
        ![
            config.elevationScale,
            config.skirtScale,
            config.elevationRange.min,
            config.elevationRange.max,
        ].every(Number.isFinite) ||
        config.elevationRange.min > config.elevationRange.max
    )
        throw new Error('Invalid finite elevation range or scale');
    if (
        config.lod.mode === 'distance'
            ? !(config.lod.distanceFactor > 0)
            : !(config.lod.targetPixels > 0)
    )
        throw new Error('Invalid LOD target');
    return Object.freeze({
        ...config,
        elevationRange: Object.freeze({ ...config.elevationRange }),
        lod: Object.freeze({ ...config.lod }),
    });
}

function equal(a: TerrainConfig, b: TerrainConfig) {
    return Object.keys(a).every((key) => {
        if (key === 'elevationRange')
            return (
                a.elevationRange.min === b.elevationRange.min &&
                a.elevationRange.max === b.elevationRange.max
            );
        if (key === 'lod') return JSON.stringify(a.lod) === JSON.stringify(b.lod);
        return a[key as keyof TerrainConfig] === b[key as keyof TerrainConfig];
    });
}

/** Explicit Three backend. The scheduler and revision store import no Three code. */
export function createTerrain(options: CreateTerrainOptions) {
    const { renderer } = options;
    const materialContext = createTerrainMaterialContext();
    const initial: TerrainConfig = {
        topology:
            options.topology ?? createFlatTopology({ rootSize: 256, origin: { x: 0, y: 0, z: 0 } }),
        elevation: options.elevation ?? (() => float(0)),
        elevationRange: options.elevationRange ?? { min: 0, max: 0 },
        elevationScale: options.elevationScale ?? 1,
        innerTileSegments: options.innerTileSegments ?? 61,
        maxNodes: options.maxNodes ?? 1024,
        maxLevel: options.maxLevel ?? 16,
        skirtScale: options.skirtScale ?? 100,
        terrainFieldFilter: options.terrainFieldFilter ?? 'linear',
        terrainFieldFormat: options.terrainFieldFormat ?? 'rgba16float',
        lod: options.lod ?? { mode: 'distance', distanceFactor: 1.5 },
    };
    type Precision = ReturnType<NonNullable<Topology['projection']['gpu']['createRenderPrecision']>>;
    type Slot = {
        graph: TerrainGraph;
        config: TerrainConfig;
        disposed: boolean;
        precision?: Precision;
        contentVersion?: number;
    };
    const slots = new Set<Slot>();
    const available: Slot[] = [];
    let selection: Slot | undefined;
    const graphListeners = new Set<GraphEventCallback>();
    let legacyQueries: (RuntimeQueries & { raycast: TerrainRaycast }) | null = null;

    async function fence() {
        const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
        await device?.queue.onSubmittedWorkDone();
    }
    async function destroy(slot: Slot) {
        if (slot.disposed) return;
        slot.disposed = true;
        const g = slot.graph;
        await g.peek(terrainTasks.terrainQuery)?.cache.pending;
        await fence();
        g.peek(terrainTasks.terrainQuery)?.cache.dispose();
        g.peek(terrainTasks.createTerrainFieldTexture)?.texture.dispose();
        // Storage attributes have no public dispose event in r182. Use the explicit
        // backend destruction boundary after all submitted work has completed.
        const attributes = [
            g.peek(terrainTasks.leafStorage)?.attribute,
            g.peek(terrainTasks.createElevationFieldContext)?.attribute,
            g.peek(terrainTasks.tileBoundsContext)?.attribute,
            g.peek(terrainTasks.gpuSpatialIndexStorage)?.attribute,
        ];
        const backend = renderer.backend as unknown as {
            destroyAttribute(attribute: unknown): void;
            get(attribute: unknown): { buffer?: unknown };
        };
        if (slot.precision) attributes.push(slot.precision.attribute);
        for (const attribute of attributes)
            if (attribute && backend.get(attribute).buffer) backend.destroyAttribute(attribute);
        g.peek(terrainTasks.compileCompute)?.dispose?.();
        const bounds = g.peek(terrainTasks.tileBoundsContext)?.kernel as
            | { dispose?: () => void }
            | undefined;
        bounds?.dispose?.();
        g.dispose();
        slots.delete(slot);
    }
    function makeSlot(config: TerrainConfig): Slot {
        const graph = terrainGraph();
        graph.set(params.materialContext, materialContext);
        graph.on((event) => {
            for (const listener of graphListeners) listener(event);
        });
        graph.set(params.topology, config.topology);
        graph.set(params.rootSize, config.topology.rootSize ?? 256);
        graph.set(params.origin, {
            ...(config.topology.origin ?? config.topology.projection.center ?? { x: 0, y: 0, z: 0 }),
        });
        graph.set(params.elevationFn, () => config.elevation);
        graph.set(params.elevationScale, config.elevationScale);
        graph.set(params.innerTileSegments, config.innerTileSegments);
        graph.set(params.maxNodes, config.maxNodes);
        graph.set(params.maxLevel, config.maxLevel);
        graph.set(params.skirtScale, config.skirtScale);
        graph.set(params.terrainFieldFilter, config.terrainFieldFilter);
        graph.set(params.terrainFieldFormat, config.terrainFieldFormat);
        const slot = { graph, config, disposed: false };
        slots.add(slot);
        return slot;
    }
    function setView(g: TerrainGraph, config: TerrainConfig, view: TerrainView) {
        g.set(params.quadtreeUpdate, {
            cameraOrigin: { x: view.position[0], y: view.position[1], z: view.position[2] },
            ...(config.lod.mode === 'screen'
                ? { ...config.lod, projectionFactor: view.projectionFactor ?? 1 }
                : config.lod),
            tileElevationRange(_tile, out) {
                const a = config.elevationRange.min * config.elevationScale;
                const b = config.elevationRange.max * config.elevationScale;
                out.min = Math.min(a, b);
                out.max = Math.max(a, b);
                return true;
            },
        });
    }
    const backend: TerrainBackend<TerrainConfig, TerrainRender> = {
        resolve,
        equal,
        async needsProductionForView(render, view) {
            // Run only selection on a retained CPU graph. Camera motion dirties
            // this branch; it is not itself a change to the elevation field.
            // Keep published graph records coherent with their GPU buffers,
            // including while a candidate with a different layout is pending.
            if (!selection || !equal(selection.config, render.config)) {
                if (selection) await destroy(selection);
                selection = makeSlot(render.config);
            }
            const g = selection.graph;
            setView(g, render.config, view);
            const report = await g.run({ targets: [terrainTasks.quadtreeUpdate], resources: { renderer } });
            if (report.status !== 'ok') throw new Error(`Terrain selection ${report.status}`);
            const leaves = g.peek(terrainTasks.quadtreeUpdate)!;
            const uploaded = render.graph.peek(terrainTasks.leafStorage)!.data;
            if (leaves.count !== render.count) return true;
            for (let i = 0; i < leaves.count; i++) {
                const offset = i * 4;
                if (leaves.level[i] !== uploaded[offset] || leaves.x[i] !== uploaded[offset + 1] ||
                    leaves.y[i] !== uploaded[offset + 2] || leaves.space[i] !== uploaded[offset + 3])
                    return true;
            }
            return false;
        },
        async produce(config, view, revision) {
            let slot: Slot | undefined;
            while (available.length) {
                const candidate = available.pop()!;
                if (equal(candidate.config, config)) {
                    slot = candidate;
                    break;
                }
                await destroy(candidate);
            }
            slot ??= makeSlot(config);
            const g = slot.graph;
            try {
                if (slot.contentVersion !== revision.contentVersion) {
                    // Rebuild captured source nodes for explicit content/resource edits.
                    g.set(
                        params.elevationFn,
                        () => ((input) => config.elevation(input)) as ElevationCallback
                    );
                    slot.contentVersion = revision.contentVersion;
                }
                setView(g, config, view);
                const report = await g.run({
                    targets: [
                        terrainTasks.executeCompute,
                        terrainTasks.positionNode,
                        terrainTasks.gpuSpatialIndexUpload,
                        terrainTasks.terrainRaycast,
                    ],
                    resources: { renderer },
                });
                if (report.status !== 'ok') throw new Error(`Terrain production ${report.status}`);
                const count = g.peek(terrainTasks.leafGpuBuffer)!.count;
                const materialContext = g.peek(terrainTasks.materialContext)!;
                slot.precision ??= config.topology.projection.gpu.createRenderPrecision?.({
                    positionNode: g.peek(terrainTasks.positionNode)!,
                    materialContext,
                    leafStorage: g.peek(terrainTasks.leafStorage)!,
                    uniforms: g.peek(terrainTasks.updateUniforms)!,
                });
                slot.precision?.update(count);
                const render = Object.freeze({
                    graph: g,
                    config,
                    count,
                    positionNode: (slot.precision?.positionNode ??
                        g.peek(terrainTasks.positionNode)!) as ShaderCallNodeInternal,
                    materialContext,
                });
                let retired = false;
                return {
                    render,
                    layoutKey: Array.from(
                        g.peek(terrainTasks.leafStorage)!.data.subarray(0, count * 4)
                    ).join(','),
                    async snapshot(): Promise<TerrainSnapshotData> {
                        const context = g.peek(terrainTasks.terrainQuery)!;
                        const cache = context.cache;
                        // Capture source identity even when the layout and compiled callback
                        // are unchanged (explicit managed content invalidation).
                        cache.triggerReadback(
                            renderer,
                            g.peek(terrainTasks.createElevationFieldContext)!.attribute,
                            g.peek(terrainTasks.quadtreeConfig)!.state.leafIndex,
                            g.peek(terrainTasks.tileBoundsContext)!.attribute,
                            render.count,
                            {}
                        );
                        await cache.pending;
                        if (cache.lastError) throw cache.lastError;
                        if (!cache.ready) throw new Error('Terrain GPU readback is unsupported');
                        const snapshot = cache.capture();
                        const projection = config.topology.projection;
                        const surfaceOps = projection.cpu.createSurfaceOps();
                        const queries = projection.cpu.createRuntimeQueries(snapshot);
                        for (const query of [
                            queries.query,
                            queries.surfaceQuery,
                            queries.sphereQuery,
                        ]) {
                            if (query)
                                Object.defineProperty(query, 'generation', {
                                    get: () => revision.productionVersion,
                                });
                        }
                        const center = config.topology.origin ??
                            projection.center ?? { x: 0, y: 0, z: 0 };
                        legacyQueries = {
                            ...queries,
                            raycast: createTerrainRaycast({
                                getProjection: () => projection,
                                getTerrainQuery: () => queries.query,
                                getSurfaceQuery: () => queries.surfaceQuery,
                                getSphereQuery: () => queries.sphereQuery,
                                getConfig: () => {
                                    const range = snapshot.getGlobalElevationRange();
                                    return {
                                        rootSize: config.topology.rootSize ?? 256,
                                        originX: center.x,
                                        originY: center.y,
                                        originZ: center.z,
                                        centerX: center.x,
                                        centerY: center.y,
                                        centerZ: center.z,
                                        minY: range?.min ?? config.elevationRange.min,
                                        maxY: range?.max ?? config.elevationRange.max,
                                    };
                                },
                            }),
                        };
                        return {
                            sample(position, revision) {
                                if (!position.every(Number.isFinite))
                                    return {
                                        status: 'unavailable',
                                        reason: 'ambiguous-projection',
                                        revision,
                                    };
                                if (
                                    surfaceOps &&
                                    !surfaceOps.positionToKey(
                                        ...position,
                                        { space: 0, u: 0, v: 0, dirX: 0, dirY: 0, dirZ: 0 }
                                    )
                                ) {
                                    return {
                                        status: 'unavailable',
                                        reason: 'ambiguous-projection',
                                        revision,
                                    };
                                }
                                const curved = snapshot.hasSurface;
                                const surface = curved
                                    ? snapshot.sampleSurfaceByPosition(...position)
                                    : null;
                                const value =
                                    surface ?? snapshot.sampleTerrain(position[0], position[2]);
                                const tile = curved
                                    ? snapshot.getTileBySurfacePosition(...position)
                                    : snapshot.getTile(position[0], position[2]);
                                if (!value.valid || !tile)
                                    return {
                                        status: 'unavailable',
                                        reason: 'outside-coverage',
                                        revision,
                                    };
                                const originY = config.topology.origin?.y ?? 0;
                                const point = surface
                                    ? surface.position
                                    : [position[0], value.elevation, position[2]];
                                return {
                                    status: 'available',
                                    revision,
                                    position: [point[0]!, point[1]!, point[2]!],
                                    normal: [...value.normal],
                                    elevation: value.elevation - (curved ? 0 : originY),
                                    tile,
                                    sampleSpacing:
                                        (config.topology.rootSize ??
                                            (config.topology.projection.radius ?? 1) * 2) /
                                        (2 ** tile.level * config.innerTileSegments),
                                };
                            },
                            dispose: () => snapshot.dispose(),
                        };
                    },
                    async retire() {
                        if (retired) return;
                        retired = true;
                        await fence();
                        available.push(slot!);
                    },
                };
            } catch (error) {
                await destroy(slot);
                throw error;
            }
        },
        async dispose() {
            for (const slot of slots) await destroy(slot);
            available.length = 0;
            legacyQueries = null;
        },
        settle: fence,
        async collectRetired() {
            for (const slot of available.splice(0)) await destroy(slot);
        },
    };
    const runtime = createTerrainRuntime(backend, initial, {
        ...options.queries,
        readback: options.queries?.readback ?? 'on-change',
    });
    const configure = runtime.configure;
    return Object.assign(runtime, {
        configure(patch: Partial<TerrainConfig>) {
            return configure({ ...runtime.getConfig(), ...patch });
        },
        onGraphEvent(listener: GraphEventCallback) {
            graphListeners.add(listener);
            return () => {
                graphListeners.delete(listener);
            };
        },
        getLegacyQueries: () => legacyQueries,
        /** Three binding resources retire only after submitted draws complete. */
        async retireBindingResource(resource: BufferGeometry | BufferAttribute) {
            await fence();
            if ('dispose' in resource) resource.dispose();
            else {
                const backend = renderer.backend as unknown as {
                    get(a: unknown): { buffer?: unknown };
                    destroyAttribute(a: unknown): void;
                };
                if (backend.get(resource).buffer) backend.destroyAttribute(resource);
            }
        },
    });
}

export type Terrain = ReturnType<typeof createTerrain>;
export type TerrainQuery = Terrain['query'];
