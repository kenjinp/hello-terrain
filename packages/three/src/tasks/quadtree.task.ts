import { task } from "@hello-terrain/work";
import {
  createDirtyVisibleSlotStorage,
  createLeafStorage,
  createVisibleSlotStorage,
} from "../gpu/leafStorage";
import type {
  ElevationRangeOut,
  LeafSet,
  SpatialIndex,
  TileId,
  TileSlotCacheState,
  TileVisibilityState,
} from "../quadtree";
import {
  allocLeafSet,
  buildLeafValueIndex,
  createSpatialIndex,
  computeTileVisibility,
  createFlatTopology,
  createState,
  update,
  updateTileSlotCache,
} from "../quadtree";
import type { QuadtreeConfigState } from "./graph.types";
import { elevationScale, maxLevel, maxNodes, origin, quadtreeUpdate, rootSize, topology } from "./params";
import { terrainQueryTask } from "./terrain-query.task";
import type { VisibleSlotStorageState } from "../types";

export type VisibleLeafSetState = {
  leaves: LeafSet;
  index: SpatialIndex;
};

export type TileIncrementalTelemetryState = {
  visibility: TileVisibilityState;
  slots: TileSlotCacheState;
  telemetry: TileSlotCacheState["telemetry"];
};

export type SlotIndexBufferState = VisibleSlotStorageState & {
  count: number;
};

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
}).displayName("topologyTask");

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
}).displayName("quadtreeConfigTask");

export const quadtreeUpdateTask = task((get, work) => {
  const quadtreeConfig = get(quadtreeConfigTask);
  const quadtreeUpdateConfig = get(quadtreeUpdate);
  const { cache } = get(terrainQueryTask);
  const elevationScaleValue = get(elevationScale);

  let outLeaves: LeafSet | undefined = undefined;
  const elevationRangeScratch = { min: 0, max: 0 };

  // Build the provider once: `cache` and `elevationScaleValue` are stable for
  // this task instance and only change when their deps do (rebuilding the task).
  // Surface-relative LOD comes from per-tile elevation bounds — `tileBounds`
  // places each tile's bounding sphere at its own readback elevation range,
  // so no global camera offset is needed.
  quadtreeUpdateConfig.tileElevationRange = (tile, out) => {
    if (!cache.getTileElevationRange(tile.space, tile.level, tile.x, tile.y, elevationRangeScratch)) {
      return false;
    }
    out.min = elevationRangeScratch.min * elevationScaleValue;
    out.max = elevationRangeScratch.max * elevationScaleValue;
    return true;
  };

  return work(() => {
    outLeaves = update(
      quadtreeConfig.state,
      quadtreeConfig.topology,
      quadtreeUpdateConfig,
      outLeaves,
    );
    return outLeaves;
  });
}).displayName("quadtreeUpdateTask");

export const tileVisibilityTask = task((get, work) => {
  const leafSet = get(quadtreeUpdateTask);
  const topologyValue = get(topologyTask);
  const updateConfig = get(quadtreeUpdate);
  const { cache } = get(terrainQueryTask);
  const elevationScaleValue = get(elevationScale);
  const elevationRangeScratch = { min: 0, max: 0 };

  const elevationRangeForTile = (tile: TileId, out: ElevationRangeOut) => {
    if (!cache.getTileElevationRange(tile.space, tile.level, tile.x, tile.y, elevationRangeScratch)) {
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
        cameraOrigin: updateConfig.cameraOrigin,
        viewProjectionMatrix: updateConfig.viewProjectionMatrix,
        elevationRangeForTile,
      },
      prev,
    ),
  );
}).displayName("tileVisibilityTask");

export const tileSlotUpdateTask = task((get, work) => {
  const leafSet = get(quadtreeUpdateTask);
  const topologyValue = get(topologyTask);
  const visibility = get(tileVisibilityTask);
  const maxNodesValue = get(maxNodes);
  const shapeKey = `${topologyValue.projection.kind}:${topologyValue.spaceCount}:${maxNodesValue}`;

  return work((prev?: TileIncrementalTelemetryState): TileIncrementalTelemetryState => {
    const slots = updateTileSlotCache(
      leafSet,
      visibility,
      maxNodesValue,
      shapeKey,
      prev?.slots,
    );
    return {
      visibility,
      slots,
      telemetry: slots.telemetry,
    };
  });
}).displayName("tileSlotUpdateTask");

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
}).displayName("visibleLeafSetTask");

/**
 * Creates the GPU storage buffer objects. Recreated when maxNodes changes.
 *
 * positionNodeTask depends on this (not leafGpuBufferTask) so
 * the shader is only rebuilt when the buffer is resized, not on every
 * quadtree update.
 */
export const leafStorageTask = task((get, work) => {
  const maxNodesVal = get(maxNodes);
  return work(() => createLeafStorage(maxNodesVal));
}).displayName("leafStorageTask");

export const visibleSlotStorageTask = task((get, work) => {
  const maxNodesVal = get(maxNodes);
  return work(() => createVisibleSlotStorage(maxNodesVal));
}).displayName("visibleSlotStorageTask");

export const dirtyVisibleSlotStorageTask = task((get, work) => {
  const maxNodesVal = get(maxNodes);
  return work(() => createDirtyVisibleSlotStorage(maxNodesVal));
}).displayName("dirtyVisibleSlotStorageTask");

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
      visibleSlotStorage.data.length,
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
}).displayName("leafGpuBufferTask");

export const dirtyVisibleSlotBufferTask = task((get, work) => {
  const slotUpdate = get(tileSlotUpdateTask);
  const dirtyVisibleSlotStorage = get(dirtyVisibleSlotStorageTask);

  return work((): SlotIndexBufferState => {
    const slots = slotUpdate.slots;
    const dirtyCount = Math.min(
      slots.telemetry.dirtyVisibleCount,
      dirtyVisibleSlotStorage.data.length,
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
}).displayName("dirtyVisibleSlotBufferTask");
