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
    TileSlotCacheState,
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
    updateTileSlotCache,
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
    /** Slot values paired with `leaves` entries (scratch for filtered sets). */
    slotValues?: Uint32Array;
};

export type TileIncrementalTelemetryState = {
    visibility: TileVisibilityState;
    residency: TileResidencyState;
    slots: TileSlotCacheState;
    telemetry: TileSlotCacheState['telemetry'];
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
        const slots = updateTileSlotCache(
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
        const slots = slotUpdate.slots;
        const canReuse = prev?.leaves.capacity === slots.capacity;
        const leaves = canReuse ? prev.leaves : allocLeafSet(slots.capacity);
        leaves.count = Math.min(slots.telemetry.visibleSlotCount, leaves.capacity);

        for (let visibleIndex = 0; visibleIndex < leaves.count; visibleIndex += 1) {
            const slot = slots.visibleSlots[visibleIndex] ?? 0;
            leaves.space[visibleIndex] = slots.slotSpace[slot] ?? 0;
            leaves.level[visibleIndex] = slots.slotLevel[slot] ?? 0;
            leaves.x[visibleIndex] = slots.slotX[slot] ?? 0;
            leaves.y[visibleIndex] = slots.slotY[slot] ?? 0;
        }

        const index = canReuse ? prev.index : createSpatialIndex(slots.capacity);
        const valueIndex = buildLeafValueIndex(leaves, slots.visibleSlots, index);
        return {
            leaves,
            index: valueIndex,
        };
    });
}).displayName('visibleLeafSetTask');

export const residentLeafSetTask = task((get, work) => {
    const slotUpdate = get(tileSlotUpdateTask);

    return work((prev?: VisibleLeafSetState): VisibleLeafSetState => {
        const slots = slotUpdate.slots;
        const canReuse = prev?.leaves.capacity === slots.capacity;
        const leaves = canReuse ? prev.leaves : allocLeafSet(slots.capacity);
        const slotValues =
            canReuse && prev.slotValues ? prev.slotValues : new Uint32Array(slots.capacity);
        const residentCount = Math.min(slots.telemetry.residentSlotCount, leaves.capacity);

        // Ready-gate the query set: only slots whose compute has actually run
        // may resolve from the spatial index. A freshly (re)allocated slot holds
        // uninitialized or a previous tile's field data — resolving it would
        // report phantom ground to queries/raycasts (e.g. falling through
        // terrain right after a teleport). Excluded tiles simply report
        // `valid: false` until their dispatch lands.
        let count = 0;
        for (let residentIndex = 0; residentIndex < residentCount; residentIndex += 1) {
            const slot = slots.residentSlots[residentIndex] ?? 0;
            if (slots.slotComputed[slot] !== 1) continue;
            leaves.space[count] = slots.slotSpace[slot] ?? 0;
            leaves.level[count] = slots.slotLevel[slot] ?? 0;
            leaves.x[count] = slots.slotX[slot] ?? 0;
            leaves.y[count] = slots.slotY[slot] ?? 0;
            slotValues[count] = slot;
            count += 1;
        }
        leaves.count = count;

        const index = canReuse ? prev.index : createSpatialIndex(slots.capacity);
        const valueIndex = buildLeafValueIndex(leaves, slotValues, index);
        return {
            leaves,
            index: valueIndex,
            slotValues,
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
        const slots = slotUpdate.slots;
        const bufferCapacity = leafStorage.data.length / 4;
        const slotCount = Math.min(slots.activeSlotCount, bufferCapacity);
        const visibleCount = Math.min(
            slots.telemetry.visibleSlotCount,
            visibleSlotStorage.data.length
        );

        for (let slot = 0; slot < slotCount; slot += 1) {
            const offset = slot * 4;
            leafStorage.data[offset] = slots.slotLevel[slot] ?? 0;
            leafStorage.data[offset + 1] = slots.slotX[slot] ?? 0;
            leafStorage.data[offset + 2] = slots.slotY[slot] ?? 0;
            // Slot 3 carries the surface space/face index (0 for flat surfaces,
            // 0..5 for cube-sphere faces). Consumed by the sphere position assembly.
            leafStorage.data[offset + 3] = slots.slotSpace[slot] ?? 0;
        }

        for (let visibleIndex = 0; visibleIndex < visibleCount; visibleIndex += 1) {
            visibleSlotStorage.data[visibleIndex] = slots.visibleSlots[visibleIndex] ?? 0;
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
        const slots = slotUpdate.slots;
        const dirtyCount = Math.min(
            slots.telemetry.dirtyVisibleCount,
            dirtyVisibleSlotStorage.data.length
        );

        for (let i = 0; i < dirtyCount; i += 1) {
            dirtyVisibleSlotStorage.data[i] = slots.dirtyVisibleSlots[i] ?? 0;
        }

        dirtyVisibleSlotStorage.attribute.needsUpdate = true;
        dirtyVisibleSlotStorage.node.needsUpdate = true;

        return {
            ...dirtyVisibleSlotStorage,
            count: dirtyCount,
        };
    });
}).displayName('dirtyVisibleSlotBufferTask');
