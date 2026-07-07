import { task } from '@hello-terrain/work';
import type { WebGPURenderer } from 'three/webgpu';
import {
    createDirtyVisibleSlotStorage,
    createLeafStorage,
    createVisibleSlotStorage,
} from '../gpu/leafStorage';
import type { LeafStorageState, VisibleSlotStorageState } from '../types';
import type {
    ElevationRangeOut,
    LeafSet,
    LodCriteria,
    SpatialIndex,
    TerrainResidencyAnchor,
    TileId,
    TileResidencyState,
    TileTable,
    TileVisibilityState,
    UpdateParams,
} from '../quadtree';
import {
    allocLeafSet,
    buildLeafValueIndex,
    createSpatialIndex,
    computeTileVisibility,
    computeTileResidency,
    createFlatTopology,
    createState,
    update,
    updateTileTable,
} from '../quadtree';
import type { QuadtreeConfigState } from './graph.types';
import type { CameraView } from './cameraView';
import {
    cameraView,
    elevationFn,
    elevationScale,
    innerTileSegments,
    lodCriteria,
    maxLevel,
    maxNodes,
    origin,
    residencyAnchors,
    radius,
    rootSize,
    topology,
} from './params';
import { terrainQueryTask } from './terrain-query.task';
import { createTileSlotShapeKey } from './cache-key';

export type VisibleLeafSetState = {
    leaves: LeafSet;
    index: SpatialIndex;
};

export type TileIncrementalTelemetryState = {
    visibility: TileVisibilityState;
    residency: TileResidencyState;
    slots: TileTable;
    telemetry: TileTable['telemetry'];
};

export type SlotIndexBufferState = VisibleSlotStorageState & {
    count: number;
};

function assembleUpdateParams(
    view: CameraView,
    anchors: readonly TerrainResidencyAnchor[],
    lod: LodCriteria
): UpdateParams {
    return {
        cameraOrigin: view.cameraOrigin,
        viewProjectionMatrix: view.viewProjectionMatrix,
        residency: anchors.length > 0 ? { anchors } : undefined,
        ...lod,
    };
}

/**
 * Derives the terrain topology from `rootSize` and `origin`.
 * Automatically recomputes when either param changes, keeping the
 * quadtree refinement in sync with the GPU-side tile positioning.
 */
export const topologyTask = task((get, work) => {
    const customTopology = get(topology);
    const rootSizeVal = get(rootSize);
    const originVal = get(origin);

    return work(() => {
        if (customTopology) return customTopology;
        return createFlatTopology({ rootSize: rootSizeVal, origin: originVal });
    });
}).displayName('topologyTask');

export const quadtreeConfigTask = task((get, work) => {
    const topologyVal = get(topologyTask);
    const maxNodesVal = get(maxNodes);
    const maxLevelVal = get(maxLevel);

    return work((): QuadtreeConfigState => {
        const state = createState({ maxNodes: maxNodesVal, maxLevel: maxLevelVal }, topologyVal);
        return {
            state,
            topology: topologyVal,
        };
    });
}).displayName('quadtreeConfigTask');

export const quadtreeUpdateTask = task((get, work) => {
    const quadtreeConfig = get(quadtreeConfigTask);
    const view = get(cameraView);
    const anchors = get(residencyAnchors);
    const lod = get(lodCriteria);
    const updateConfig = assembleUpdateParams(view, anchors, lod);
    const { cache } = get(terrainQueryTask);
    const elevationScaleValue = get(elevationScale);

    let outLeaves: LeafSet | undefined = undefined;
    const elevationRangeScratch = { min: 0, max: 0 };

    // Build the provider once: `cache` and `elevationScaleValue` are stable for
    // this task instance and only change when their deps do (rebuilding the task).
    // Surface-relative LOD comes from per-tile elevation bounds — `tileBounds`
    // places each tile's bounding sphere at its own readback elevation range,
    // so no global camera offset is needed.
    updateConfig.tileElevationRange = (tile, out) => {
        if (
            !cache.getTileElevationRange(
                tile.space,
                tile.level,
                tile.x,
                tile.y,
                elevationRangeScratch
            )
        ) {
            return false;
        }
        out.min = elevationRangeScratch.min * elevationScaleValue;
        out.max = elevationRangeScratch.max * elevationScaleValue;
        return true;
    };

    return work(() => {
        outLeaves = update(quadtreeConfig.state, quadtreeConfig.topology, updateConfig, outLeaves);
        return outLeaves;
    });
}).displayName('quadtreeUpdateTask');

export const tileVisibilityTask = task((get, work) => {
    const leafSet = get(quadtreeUpdateTask);
    const topologyValue = get(topologyTask);
    const view = get(cameraView);
    const { cache } = get(terrainQueryTask);
    const elevationScaleValue = get(elevationScale);
    const elevationRangeScratch = { min: 0, max: 0 };

    const elevationRangeForTile = (tile: TileId, out: ElevationRangeOut) => {
        if (
            !cache.getTileElevationRange(
                tile.space,
                tile.level,
                tile.x,
                tile.y,
                elevationRangeScratch
            )
        ) {
            return false;
        }
        out.min = elevationRangeScratch.min * elevationScaleValue;
        out.max = elevationRangeScratch.max * elevationScaleValue;
        return true;
    };

    return work((prev?: TileVisibilityState) =>
        computeTileVisibility(
            {
                leaves: leafSet,
                topology: topologyValue,
                cameraOrigin: view.cameraOrigin,
                viewProjectionMatrix: view.viewProjectionMatrix,
                elevationRangeForTile,
            },
            prev
        )
    );
}).displayName('tileVisibilityTask');

export const tileResidencyTask = task((get, work) => {
    const leafSet = get(quadtreeUpdateTask);
    const visibility = get(tileVisibilityTask);
    const topologyValue = get(topologyTask);
    const view = get(cameraView);
    const anchors = get(residencyAnchors);
    const { cache } = get(terrainQueryTask);
    const elevationScaleValue = get(elevationScale);
    const elevationRangeScratch = { min: 0, max: 0 };

    const elevationRangeForTile = (tile: TileId, out: ElevationRangeOut) => {
        if (
            !cache.getTileElevationRange(
                tile.space,
                tile.level,
                tile.x,
                tile.y,
                elevationRangeScratch
            )
        ) {
            return false;
        }
        out.min = elevationRangeScratch.min * elevationScaleValue;
        out.max = elevationRangeScratch.max * elevationScaleValue;
        return true;
    };

    return work((prev?: TileResidencyState) =>
        computeTileResidency(
            {
                leaves: leafSet,
                visibility,
                topology: topologyValue,
                cameraOrigin: view.cameraOrigin,
                residency: anchors.length > 0 ? { anchors } : undefined,
                elevationRangeForTile,
            },
            prev
        )
    );
}).displayName('tileResidencyTask');

/**
 * Graph-owned epoch for field data contents.
 *
 * The slot cache only needs a cheap monotonic token. This task reads every
 * dependency that can change generated field values, then lets the work graph
 * invalidate and re-run it when any of those dependencies changes.
 */
export const terrainFieldContentEpochTask = task((get, work) => {
    void get(topologyTask);
    void get(rootSize);
    void get(origin);
    void get(radius);
    void get(innerTileSegments);
    void get(elevationScale);
    void get(elevationFn);

    return work((prev?: number) => (prev ?? 0) + 1);
}).displayName('terrainFieldContentEpochTask');

export const tileSlotUpdateTask = task((get, work) => {
    const leafSet = get(quadtreeUpdateTask);
    const topologyValue = get(topologyTask);
    const visibility = get(tileVisibilityTask);
    const residency = get(tileResidencyTask);
    const maxNodesValue = get(maxNodes);
    const contentEpoch = get(terrainFieldContentEpochTask);
    const shapeKey = createTileSlotShapeKey(topologyValue, maxNodesValue);

    return work((prev?: TileIncrementalTelemetryState): TileIncrementalTelemetryState => {
        const slots = updateTileTable(
            leafSet,
            visibility,
            residency,
            maxNodesValue,
            shapeKey,
            contentEpoch,
            prev?.slots
        );
        return {
            visibility,
            residency,
            slots,
            telemetry: slots.telemetry,
        };
    });
}).displayName('tileSlotUpdateTask');

export const visibleLeafSetTask = task((get, work) => {
    const slotUpdate = get(tileSlotUpdateTask);

    return work((prev?: VisibleLeafSetState): VisibleLeafSetState => {
        const table = slotUpdate.slots;
        const canReuse = prev?.leaves.capacity === table.capacity;
        const leaves = canReuse ? prev.leaves : allocLeafSet(table.capacity);
        leaves.count = Math.min(table.telemetry.visibleSlotCount, leaves.capacity);

        for (let visibleIndex = 0; visibleIndex < leaves.count; visibleIndex += 1) {
            const row = table.drawRows[visibleIndex] ?? 0;
            leaves.space[visibleIndex] = table.space[row] ?? 0;
            leaves.level[visibleIndex] = table.level[row] ?? 0;
            leaves.x[visibleIndex] = table.x[row] ?? 0;
            leaves.y[visibleIndex] = table.y[row] ?? 0;
        }

        const index = canReuse ? prev.index : createSpatialIndex(table.capacity);
        const valueIndex = buildLeafValueIndex(leaves, table.drawRows, index);
        return {
            leaves,
            index: valueIndex,
        };
    });
}).displayName('visibleLeafSetTask');

export const residentLeafSetTask = task((get, work) => {
    const slotUpdate = get(tileSlotUpdateTask);

    return work((prev?: VisibleLeafSetState): VisibleLeafSetState => {
        const table = slotUpdate.slots;
        const canReuse = prev?.leaves.capacity === table.capacity;
        const leaves = canReuse ? prev.leaves : allocLeafSet(table.capacity);

        // queryRows is the ready-gated view: only rows whose compute has
        // actually run may resolve from queries/raycasts/the GPU spatial index
        // (a fresh row holds uninitialized or a previous tile's field data —
        // resolving it would report phantom ground, e.g. falling through
        // terrain right after a teleport). Excluded tiles report
        // `valid: false` until their dispatch lands.
        leaves.count = Math.min(table.queryRowCount, leaves.capacity);
        for (let queryIndex = 0; queryIndex < leaves.count; queryIndex += 1) {
            const row = table.queryRows[queryIndex] ?? 0;
            leaves.space[queryIndex] = table.space[row] ?? 0;
            leaves.level[queryIndex] = table.level[row] ?? 0;
            leaves.x[queryIndex] = table.x[row] ?? 0;
            leaves.y[queryIndex] = table.y[row] ?? 0;
        }

        const index = canReuse ? prev.index : createSpatialIndex(table.capacity);
        const valueIndex = buildLeafValueIndex(leaves, table.queryRows, index);
        return {
            leaves,
            index: valueIndex,
        };
    });
}).displayName('residentLeafSetTask');

/**
 * Creates the GPU storage buffer objects. Recreated when maxNodes changes.
 *
 * positionNodeTask depends on this (not leafGpuBufferTask) so
 * the shader is only rebuilt when the buffer is resized, not on every
 * quadtree update.
 */
export const leafStorageTask = task<{ renderer: WebGPURenderer }>((get, work, ctx) => {
    const maxNodesVal = get(maxNodes);
    return work((prev?: LeafStorageState) => {
        prev?.dispose?.();
        return createLeafStorage(maxNodesVal, ctx.resources?.renderer);
    });
})
    .displayName('leafStorageTask')
    .disposer((state) => state.dispose?.());

export const visibleSlotStorageTask = task<{ renderer: WebGPURenderer }>((get, work, ctx) => {
    const maxNodesVal = get(maxNodes);
    return work((prev?: VisibleSlotStorageState) => {
        prev?.dispose?.();
        return createVisibleSlotStorage(maxNodesVal, ctx.resources?.renderer);
    });
})
    .displayName('visibleSlotStorageTask')
    .disposer((state) => state.dispose?.());

export const dirtyVisibleSlotStorageTask = task<{ renderer: WebGPURenderer }>((get, work, ctx) => {
    const maxNodesVal = get(maxNodes);
    return work((prev?: VisibleSlotStorageState) => {
        prev?.dispose?.();
        return createDirtyVisibleSlotStorage(maxNodesVal, ctx.resources?.renderer);
    });
})
    .displayName('dirtyVisibleSlotStorageTask')
    .disposer((state) => state.dispose?.());

export const leafGpuBufferTask = task((get, work) => {
    const slotUpdate = get(tileSlotUpdateTask);
    const leafStorage = get(leafStorageTask);
    const visibleSlotStorage = get(visibleSlotStorageTask);
    return work(() => {
        const table = slotUpdate.slots;
        const bufferCapacity = leafStorage.data.length / 4;
        const slotCount = Math.min(table.activeRowCount, bufferCapacity);
        const visibleCount = Math.min(
            table.telemetry.visibleSlotCount,
            visibleSlotStorage.data.length
        );

        for (let row = 0; row < slotCount; row += 1) {
            const offset = row * 4;
            leafStorage.data[offset] = table.level[row] ?? 0;
            leafStorage.data[offset + 1] = table.x[row] ?? 0;
            leafStorage.data[offset + 2] = table.y[row] ?? 0;
            // Slot 3 carries the surface space/face index (0 for flat surfaces,
            // 0..5 for cube-sphere faces). Consumed by the sphere position assembly.
            leafStorage.data[offset + 3] = table.space[row] ?? 0;
        }

        for (let visibleIndex = 0; visibleIndex < visibleCount; visibleIndex += 1) {
            visibleSlotStorage.data[visibleIndex] = table.drawRows[visibleIndex] ?? 0;
        }

        leafStorage.attribute.needsUpdate = true;
        leafStorage.node.needsUpdate = true;
        visibleSlotStorage.attribute.needsUpdate = true;
        visibleSlotStorage.node.needsUpdate = true;
        return {
            count: visibleCount,
            activeSlotCount: slotCount,
            data: leafStorage.data,
            attribute: leafStorage.attribute,
            node: leafStorage.node,
            visibleSlotStorage,
        };
    });
}).displayName('leafGpuBufferTask');

export const dirtyVisibleSlotBufferTask = task((get, work) => {
    const slotUpdate = get(tileSlotUpdateTask);
    const dirtyVisibleSlotStorage = get(dirtyVisibleSlotStorageTask);

    return work((): SlotIndexBufferState => {
        const table = slotUpdate.slots;
        const dirtyCount = Math.min(
            table.telemetry.dirtyResidentCount,
            dirtyVisibleSlotStorage.data.length
        );

        for (let i = 0; i < dirtyCount; i += 1) {
            dirtyVisibleSlotStorage.data[i] = table.dirtyRows[i] ?? 0;
        }

        dirtyVisibleSlotStorage.attribute.needsUpdate = true;
        dirtyVisibleSlotStorage.node.needsUpdate = true;

        return {
            ...dirtyVisibleSlotStorage,
            count: dirtyCount,
        };
    });
}).displayName('dirtyVisibleSlotBufferTask');
