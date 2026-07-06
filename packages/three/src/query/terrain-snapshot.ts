import type { StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';
import {
    TILE_BOUNDS_FLOATS_PER_TILE,
    TILE_BOUNDS_LOD_MAX_OFFSET,
    TILE_BOUNDS_LOD_MIN_OFFSET,
} from '../gpu/terrainFieldStorage';
import type { SpatialIndex } from '../quadtree';
import { createSpatialIndex } from '../quadtree';
import {
    type Float32ReadbackRange,
    type ReadbackSlot,
    canDeviceReadback,
    createReadbackSlot,
    disposeReadbackSlot,
    readStorageBufferRangesInto,
} from '../gpu/bufferReadback';
import {
    buildTileElevationPyramid,
    createTileElevationPyramid,
    type TileElevationPyramid,
} from './tile-elevation-pyramid';
import type { ElevationRange } from './types';

/**
 * Double-buffered CPU snapshot of GPU terrain production, paired with the
 * spatial-index generation it was produced from.
 *
 * Spatial index snapshot consistency contract:
 * - GPU elevation/bounds readback completes asynchronously.
 * - Quadtree/index state can mutate before readback completion.
 * - CPU query snapshots must pair elevation/bounds with the matching index generation.
 *
 * Therefore the source index is cloned into the back-buffer before scheduling
 * async readback. This copy is required for correctness unless the
 * quadtree/index itself provides immutable frame snapshots.
 */
export interface TerrainSnapshotState {
    frontElevation: Float32Array<ArrayBuffer>;
    backElevation: Float32Array<ArrayBuffer>;
    frontIndex: SpatialIndex;
    backIndex: SpatialIndex;
    frontTileBounds: Float32Array<ArrayBuffer>;
    backTileBounds: Float32Array<ArrayBuffer>;
    frontLeafCount: number;
    globalRange: ElevationRange | null;
    hasSnapshot: boolean;
    readbackPending: boolean;
    generation: number;
    lastScheduledStampGen: number;
    elevationReadback: ReadbackSlot;
    boundsReadback: ReadbackSlot;
    /** Conservative per-tile elevation range pyramid for LOD bounds. */
    elevationPyramid: TileElevationPyramid;
}

type RendererReadback = WebGPURenderer & {
    getArrayBufferAsync?: (attribute: StorageBufferAttribute) => Promise<ArrayBuffer>;
};

type SnapshotCapture = {
    activeLeafCount: number;
    totalElements: number;
    verticesPerNode: number;
    elevationScale: number;
    originY: number;
    dirtySlots?: ArrayLike<number>;
    dirtySlotCount?: number;
};

export function createTerrainSnapshotState(
    maxNodes: number,
    maxLevel: number,
    totalElements: number
): TerrainSnapshotState {
    return {
        frontElevation: new Float32Array(totalElements),
        backElevation: new Float32Array(totalElements),
        frontIndex: createSpatialIndex(maxNodes),
        backIndex: createSpatialIndex(maxNodes),
        frontTileBounds: new Float32Array(maxNodes * TILE_BOUNDS_FLOATS_PER_TILE),
        backTileBounds: new Float32Array(maxNodes * TILE_BOUNDS_FLOATS_PER_TILE),
        frontLeafCount: 0,
        globalRange: null,
        hasSnapshot: false,
        readbackPending: false,
        generation: 0,
        lastScheduledStampGen: -1,
        elevationReadback: createReadbackSlot(),
        boundsReadback: createReadbackSlot(),
        elevationPyramid: createTileElevationPyramid(maxNodes, maxLevel),
    };
}

function cloneSpatialIndex(target: SpatialIndex, source: SpatialIndex): void {
    if (target.size !== source.size) {
        throw new Error(`SpatialIndex size mismatch (target=${target.size}, source=${source.size}).`);
    }
    target.mask = source.mask;
    target.stampGen = source.stampGen;
    target.stamp.set(source.stamp);
    target.keysSpace.set(source.keysSpace);
    target.keysLevel.set(source.keysLevel);
    target.keysX.set(source.keysX);
    target.keysY.set(source.keysY);
    target.values.set(source.values);
}

function collectDirtySlots(
    dirtySlots: ArrayLike<number> | undefined,
    dirtySlotCount: number | undefined,
    activeLeafCount: number
): number[] {
    const count = Math.min(dirtySlotCount ?? 0, dirtySlots?.length ?? 0);
    const unique = new Set<number>();
    for (let i = 0; i < count; i += 1) {
        const slot = Math.floor(dirtySlots?.[i] ?? -1);
        if (slot >= 0 && slot < activeLeafCount) unique.add(slot);
    }
    return [...unique];
}

function collectVisibleSlots(index: SpatialIndex, activeLeafCount: number): number[] {
    const slots: number[] = [];
    const seen = new Set<number>();
    const stampGen = index.stampGen;
    for (let slot = 0; slot < index.size; slot += 1) {
        if (index.stamp[slot] !== stampGen) continue;
        const leafIndex = index.values[slot] ?? 0;
        if (leafIndex >= activeLeafCount || seen.has(leafIndex)) continue;
        slots.push(leafIndex);
        seen.add(leafIndex);
    }
    return slots;
}

function slotRanges(slots: readonly number[], elementsPerSlot: number): Float32ReadbackRange[] {
    return slots.map((slot) => ({
        sourceOffset: slot * elementsPerSlot,
        targetOffset: slot * elementsPerSlot,
        elementCount: elementsPerSlot,
    }));
}

function recomputeSnapshotRanges(
    state: TerrainSnapshotState,
    activeLeafCount: number,
    elevationScale: number,
    originY: number
): void {
    if (activeLeafCount <= 0) {
        state.globalRange = null;
        buildTileElevationPyramid(
            state.elevationPyramid,
            state.frontIndex,
            state.frontTileBounds,
            activeLeafCount
        );
        return;
    }

    let gMin = Infinity;
    let gMax = -Infinity;
    let found = false;
    const stampGen = state.frontIndex.stampGen;
    for (let slot = 0; slot < state.frontIndex.size; slot += 1) {
        if (state.frontIndex.stamp[slot] !== stampGen) continue;
        const leafIndex = state.frontIndex.values[slot] ?? 0;
        if (leafIndex >= activeLeafCount) continue;

        const rawMin =
            state.frontTileBounds[
                leafIndex * TILE_BOUNDS_FLOATS_PER_TILE + TILE_BOUNDS_LOD_MIN_OFFSET
            ] ?? 0;
        const rawMax =
            state.frontTileBounds[
                leafIndex * TILE_BOUNDS_FLOATS_PER_TILE + TILE_BOUNDS_LOD_MAX_OFFSET
            ] ?? 0;
        const a = originY + rawMin * elevationScale;
        const b = originY + rawMax * elevationScale;
        gMin = Math.min(gMin, a, b);
        gMax = Math.max(gMax, a, b);
        found = true;
    }

    state.globalRange = found ? { min: gMin, max: gMax } : null;
    buildTileElevationPyramid(
        state.elevationPyramid,
        state.frontIndex,
        state.frontTileBounds,
        activeLeafCount
    );
}

function copyCleanVisibleSlotsToBack(
    state: TerrainSnapshotState,
    activeLeafCount: number,
    verticesPerNode: number,
    dirtySlotSet: ReadonlySet<number>
): void {
    if (!state.hasSnapshot) return;

    const stampGen = state.backIndex.stampGen;
    const copied = new Set<number>();
    for (let slot = 0; slot < state.backIndex.size; slot += 1) {
        if (state.backIndex.stamp[slot] !== stampGen) continue;
        const leafIndex = state.backIndex.values[slot] ?? 0;
        if (leafIndex >= activeLeafCount || dirtySlotSet.has(leafIndex) || copied.has(leafIndex)) {
            continue;
        }

        const vertexOffset = leafIndex * verticesPerNode;
        state.backElevation.set(
            state.frontElevation.subarray(vertexOffset, vertexOffset + verticesPerNode),
            vertexOffset
        );

        const boundsOffset = leafIndex * TILE_BOUNDS_FLOATS_PER_TILE;
        for (let k = 0; k < TILE_BOUNDS_FLOATS_PER_TILE; k += 1) {
            state.backTileBounds[boundsOffset + k] = state.frontTileBounds[boundsOffset + k] ?? 0;
        }
        copied.add(leafIndex);
    }
}

/**
 * Schedule an async GPU readback of the elevation field (and optionally tile
 * bounds) into the snapshot back-buffers, then swap front/back on completion.
 *
 * No-ops when a readback is already pending, the renderer does not support
 * readback, or the spatial index has not advanced since the last schedule.
 * `captured` values are pinned at schedule time so the swapped-in snapshot is
 * internally consistent even if the config mutates while the readback flies.
 */
export function triggerSnapshotReadback(
    state: TerrainSnapshotState,
    renderer: WebGPURenderer,
    attribute: StorageBufferAttribute,
    spatialIndex: SpatialIndex,
    boundsAttribute: StorageBufferAttribute | undefined,
    captured: SnapshotCapture
): void {
    if (state.readbackPending) return;
    const withReadback = renderer as RendererReadback;
    const useDeviceReadback = canDeviceReadback(renderer);
    if (!useDeviceReadback && !withReadback.getArrayBufferAsync) return;
    if (spatialIndex.stampGen === state.lastScheduledStampGen) return;

    cloneSpatialIndex(state.backIndex, spatialIndex);
    state.lastScheduledStampGen = spatialIndex.stampGen;

    const { activeLeafCount, totalElements, verticesPerNode, elevationScale, originY } = captured;
    const dirtySlots = collectDirtySlots(
        captured.dirtySlots,
        captured.dirtySlotCount,
        activeLeafCount
    );

    state.readbackPending = true;

    /** Promote the (already-populated) back buffers to front and recompute range. */
    const promoteBackSnapshot = (boundsFilled: boolean) => {
        const oldFrontElevation = state.frontElevation;
        const oldFrontIndex = state.frontIndex;
        state.frontElevation = state.backElevation;
        state.frontIndex = state.backIndex;
        state.frontLeafCount = activeLeafCount;
        state.backElevation = oldFrontElevation;
        state.backIndex = oldFrontIndex;
        if (boundsFilled) {
            const oldFrontBounds = state.frontTileBounds;
            state.frontTileBounds = state.backTileBounds;
            state.backTileBounds = oldFrontBounds;
        }

        if (boundsFilled) {
            recomputeSnapshotRanges(state, activeLeafCount, elevationScale, originY);
        }

        state.hasSnapshot = true;
        state.generation += 1;
    };

    const promoteIndexOnlySnapshot = () => {
        const oldFrontIndex = state.frontIndex;
        state.frontIndex = state.backIndex;
        state.backIndex = oldFrontIndex;
        state.frontLeafCount = activeLeafCount;
        recomputeSnapshotRanges(state, activeLeafCount, elevationScale, originY);
        state.hasSnapshot = true;
        state.generation += 1;
    };

    const effectiveDirtySlots = state.hasSnapshot
        ? dirtySlots
        : collectVisibleSlots(state.backIndex, activeLeafCount);

    if (effectiveDirtySlots.length === 0 && state.hasSnapshot) {
        promoteIndexOnlySnapshot();
        state.readbackPending = false;
        return;
    }

    if (useDeviceReadback) {
        const runDeviceReadback = async (): Promise<void> => {
            const dirtySlotSet = new Set(effectiveDirtySlots);
            copyCleanVisibleSlotsToBack(state, activeLeafCount, verticesPerNode, dirtySlotSet);

            const elevationFilled = await readStorageBufferRangesInto(
                renderer,
                attribute,
                state.elevationReadback,
                state.backElevation,
                slotRanges(effectiveDirtySlots, verticesPerNode),
                'terrainElevationReadback'
            );
            if (!elevationFilled) return;

            let boundsFilled = false;
            if (boundsAttribute) {
                boundsFilled = await readStorageBufferRangesInto(
                    renderer,
                    boundsAttribute,
                    state.boundsReadback,
                    state.backTileBounds,
                    slotRanges(effectiveDirtySlots, TILE_BOUNDS_FLOATS_PER_TILE),
                    'terrainBoundsReadback'
                );
            }

            promoteBackSnapshot(boundsFilled);
        };

        runDeviceReadback().finally(() => {
            state.readbackPending = false;
        });
        return;
    }

    if (dirtySlots.length === 0 && state.hasSnapshot) {
        promoteIndexOnlySnapshot();
        state.readbackPending = false;
        return;
    }

    // Fallback: Three.js' allocating readback (used when no WebGPU backend is
    // available, e.g. in unit tests). Reads the full buffers.
    const onComplete = (elevResult: ArrayBuffer, boundsResult: ArrayBuffer | null) => {
        const data = new Float32Array(elevResult);
        state.backElevation.fill(0);
        state.backElevation.set(data.subarray(0, totalElements));

        let boundsFilled = false;
        if (boundsResult) {
            const rawBounds = new Float32Array(boundsResult);
            state.backTileBounds.fill(0);
            state.backTileBounds.set(
                rawBounds.subarray(0, activeLeafCount * TILE_BOUNDS_FLOATS_PER_TILE)
            );
            boundsFilled = true;
        }

        promoteBackSnapshot(boundsFilled);
    };

    const elevationPromise = withReadback.getArrayBufferAsync!(attribute);
    const boundsPromise = boundsAttribute ? withReadback.getArrayBufferAsync!(boundsAttribute) : null;

    if (boundsPromise) {
        Promise.all([elevationPromise, boundsPromise])
            .then(([elev, bounds]) => onComplete(elev, bounds))
            .finally(() => {
                state.readbackPending = false;
            });
    } else {
        elevationPromise
            .then((elev) => onComplete(elev, null))
            .finally(() => {
                state.readbackPending = false;
            });
    }
}

/** Destroy the GPU staging buffers held by the snapshot state. */
export function disposeSnapshotReadback(state: TerrainSnapshotState): void {
    disposeReadbackSlot(state.elevationReadback);
    disposeReadbackSlot(state.boundsReadback);
}
