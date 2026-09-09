import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import {
  TILE_BOUNDS_FLOATS_PER_TILE,
  TILE_BOUNDS_LOD_MAX_OFFSET,
  TILE_BOUNDS_LOD_MIN_OFFSET,
} from "../runtime/fieldLayout";
import type { SpatialIndex } from "../quadtree";
import { createSpatialIndex } from "../quadtree/spatialIndex";
import {
  type ReadbackSlot,
  canDeviceReadback,
  createReadbackSlot,
  disposeReadbackSlot,
  readStorageBufferInto,
} from "../gpu/bufferReadback";
import {
  buildTileElevationPyramid,
  createTileElevationPyramid,
  type TileElevationPyramid,
} from "./tile-elevation-pyramid";
import type { ElevationRange } from "./types";

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
  disposed: boolean;
  generation: number;
  pending: Promise<void> | null;
  lastError: unknown;
  lastScheduledStampGen: number;
  lastScheduledContentKey?: object;
  elevationReadback: ReadbackSlot;
  boundsReadback: ReadbackSlot;
  /** Conservative per-tile elevation range pyramid for LOD bounds. */
  elevationPyramid: TileElevationPyramid;
}

type RendererReadback = WebGPURenderer & {
  getArrayBufferAsync?: (attribute: StorageBufferAttribute) => Promise<ArrayBuffer>;
};

export function createTerrainSnapshotState(
  maxNodes: number,
  maxLevel: number,
  totalElements: number,
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
    disposed: false,
    generation: 0,
    pending: null,
    lastError: null,
    lastScheduledStampGen: -1,
    elevationReadback: createReadbackSlot(),
    boundsReadback: createReadbackSlot(),
    elevationPyramid: createTileElevationPyramid(maxNodes, maxLevel),
  };
}

export function cloneSpatialIndex(target: SpatialIndex, source: SpatialIndex): void {
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

/**
 * Schedule an async GPU readback of the elevation field (and optionally tile
 * bounds) into the snapshot back-buffers, then swap front/back on completion.
 *
 * No-ops when a readback is already pending, the renderer does not support
 * readback, or neither the spatial index nor production content has changed.
 * `captured` values are pinned at schedule time so the swapped-in snapshot is
 * internally consistent even if the config mutates while the readback flies.
 */
export function triggerSnapshotReadback(
  state: TerrainSnapshotState,
  renderer: WebGPURenderer,
  attribute: StorageBufferAttribute,
  spatialIndex: SpatialIndex,
  boundsAttribute: StorageBufferAttribute | undefined,
  captured: {
    activeLeafCount: number;
    totalElements: number;
    verticesPerNode: number;
    elevationScale: number;
    originY: number;
    contentKey?: object;
    onPublish?: () => void;
  },
): void {
  if (state.disposed || state.readbackPending) return;
  const withReadback = renderer as RendererReadback;
  const useDeviceReadback = canDeviceReadback(renderer);
  if (!useDeviceReadback && !withReadback.getArrayBufferAsync) return;
  if (
    spatialIndex.stampGen === state.lastScheduledStampGen &&
    captured.contentKey === state.lastScheduledContentKey
  )
    return;

  cloneSpatialIndex(state.backIndex, spatialIndex);
  state.lastScheduledStampGen = spatialIndex.stampGen;
  state.lastScheduledContentKey = captured.contentKey;

  const { activeLeafCount, totalElements, verticesPerNode, elevationScale, originY } = captured;

  state.readbackPending = true;
  state.lastError = null;

  /** Promote the (already-populated) back buffers to front and recompute range. */
  const applySnapshot = (boundsFilled: boolean) => {
    if (state.disposed) return;
    // Zero is valid terrain data. Completion, never payload magnitude, is validity.
    const boundsValid = boundsFilled;

    const oldFrontElevation = state.frontElevation;
    const oldFrontIndex = state.frontIndex;
    state.frontElevation = state.backElevation;
    state.frontIndex = state.backIndex;
    state.frontLeafCount = activeLeafCount;
    state.backElevation = oldFrontElevation;
    state.backIndex = oldFrontIndex;
    if (boundsFilled && boundsValid) {
      const oldFrontBounds = state.frontTileBounds;
      state.frontTileBounds = state.backTileBounds;
      state.backTileBounds = oldFrontBounds;
    }
    if (!boundsFilled || activeLeafCount === 0) state.globalRange = null;

    if (boundsFilled && boundsValid && activeLeafCount > 0) {
      let gMin = Infinity;
      let gMax = -Infinity;
      for (let i = 0; i < activeLeafCount; i++) {
        const rawMin =
          state.frontTileBounds[i * TILE_BOUNDS_FLOATS_PER_TILE + TILE_BOUNDS_LOD_MIN_OFFSET]!;
        const rawMax =
          state.frontTileBounds[i * TILE_BOUNDS_FLOATS_PER_TILE + TILE_BOUNDS_LOD_MAX_OFFSET]!;
        const a = originY + rawMin * elevationScale;
        const b = originY + rawMax * elevationScale;
        gMin = Math.min(gMin, a, b);
        gMax = Math.max(gMax, a, b);
      }
      state.globalRange = { min: gMin, max: gMax };
      buildTileElevationPyramid(
        state.elevationPyramid,
        state.frontIndex,
        state.frontTileBounds,
        activeLeafCount,
      );
    }

    state.hasSnapshot = true;
    state.generation += 1;
    captured.onPublish?.();
  };

  if (useDeviceReadback) {
    const runDeviceReadback = async (): Promise<void> => {
      state.backElevation.fill(0);
      state.backTileBounds.fill(0);
      // Both calls submit their copies synchronously before either map awaits.
      // A subsequent compute submission therefore cannot split this pair.
      const elevationCopy = readStorageBufferInto(
        renderer,
        attribute,
        state.elevationReadback,
        state.backElevation,
        activeLeafCount * verticesPerNode,
        "terrainElevationReadback",
      );
      const boundsCopy = boundsAttribute
        ? readStorageBufferInto(
          renderer,
          boundsAttribute,
          state.boundsReadback,
          state.backTileBounds,
          activeLeafCount * TILE_BOUNDS_FLOATS_PER_TILE,
          "terrainBoundsReadback",
        )
        : Promise.resolve(false);
      const [elevationFilled, boundsFilled] = await Promise.all([elevationCopy, boundsCopy]);
      if (!elevationFilled || (boundsAttribute && !boundsFilled)) {
        throw new Error("Terrain snapshot source buffer is unavailable");
      }
      applySnapshot(boundsFilled);
    };

    state.pending = runDeviceReadback()
      .catch(onFailure)
      .finally(() => {
        state.readbackPending = false;
      });
    return;
  }

  // Fallback: Three.js' allocating readback (used when no WebGPU backend is
  // available, e.g. in unit tests). Reads the full buffers.
  const onComplete = (elevResult: ArrayBuffer, boundsResult: ArrayBuffer | null) => {
    if (state.disposed) return;
    const data = new Float32Array(elevResult);
    state.backElevation.fill(0);
    state.backElevation.set(data.subarray(0, totalElements));

    let boundsFilled = false;
    if (boundsResult) {
      const rawBounds = new Float32Array(boundsResult);
      state.backTileBounds.fill(0);
      state.backTileBounds.set(
        rawBounds.subarray(0, activeLeafCount * TILE_BOUNDS_FLOATS_PER_TILE),
      );
      boundsFilled = true;
    }

    applySnapshot(boundsFilled);
  };

  const elevationPromise = withReadback.getArrayBufferAsync!(attribute);
  const boundsPromise = boundsAttribute ? withReadback.getArrayBufferAsync!(boundsAttribute) : null;

  if (boundsPromise) {
    state.pending = Promise.all([elevationPromise, boundsPromise])
      .then(([elev, bounds]) => onComplete(elev, bounds))
      .catch(onFailure)
      .finally(() => {
        state.readbackPending = false;
      });
  } else {
    state.pending = elevationPromise
      .then((elev) => onComplete(elev, null))
      .catch(onFailure)
      .finally(() => {
        state.readbackPending = false;
      });
  }

  function onFailure(error: unknown): void {
    // Mapping may reject during disposal or device loss. Retain the last
    // published snapshot and allow a later update to retry the same content.
    state.lastScheduledStampGen = -1;
    state.lastScheduledContentKey = undefined;
    state.lastError = error;
  }
}

/** Destroy the GPU staging buffers held by the snapshot state. */
export function disposeSnapshotReadback(state: TerrainSnapshotState): void {
  state.disposed = true;
  disposeReadbackSlot(state.elevationReadback);
  disposeReadbackSlot(state.boundsReadback);
}
