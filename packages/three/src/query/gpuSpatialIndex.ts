import { storage, uint } from "three/tsl";
import type { Node } from "three/webgpu";
import { StorageBufferAttribute } from "three/webgpu";
import {
  buildLeafIndex,
  createSpatialIndex,
  type SpatialIndex,
} from "../quadtree/leafIndex";
import type { LeafSet } from "../quadtree";
import type { GpuSpatialIndexContext, GpuSpatialIndexData } from "./types";

const SPATIAL_INDEX_STRIDE = 6;

export interface GpuSpatialIndexState extends GpuSpatialIndexContext {
  readonly attribute: StorageBufferAttribute;
}

function createPackedBuffer(data: GpuSpatialIndexData): Uint32Array {
  const packed = new Uint32Array(data.size * SPATIAL_INDEX_STRIDE);
  for (let slot = 0; slot < data.size; slot += 1) {
    const base = slot * SPATIAL_INDEX_STRIDE;
    packed[base] = data.stamp[slot] ?? 0;
    packed[base + 1] = data.keysSpace[slot] ?? 0;
    packed[base + 2] = data.keysLevel[slot] ?? 0;
    packed[base + 3] = data.keysX[slot] ?? 0;
    packed[base + 4] = data.keysY[slot] ?? 0;
    packed[base + 5] = data.values[slot] ?? 0;
  }
  return packed;
}

export function createGpuSpatialIndexData(
  leafSet: LeafSet,
  maxLevel: number,
  reusableIndex?: SpatialIndex,
): { data: GpuSpatialIndexData; index: SpatialIndex } {
  const index =
    reusableIndex && reusableIndex.size >= Math.max(2, leafSet.count * 2)
      ? buildLeafIndex(leafSet, reusableIndex)
      : buildLeafIndex(leafSet, createSpatialIndex(Math.max(1, leafSet.count)));

  const data: GpuSpatialIndexData = {
    count: leafSet.count,
    size: index.size,
    mask: index.mask,
    stampGen: index.stampGen,
    stamp: new Uint32Array(index.stamp),
    keysSpace: new Uint32Array(index.keysSpace),
    keysLevel: new Uint32Array(index.keysLevel),
    keysX: new Uint32Array(index.keysX),
    keysY: new Uint32Array(index.keysY),
    values: new Uint32Array(index.values),
  };

  return { data, index };
}

export function createGpuSpatialIndexState(
  data: GpuSpatialIndexData,
  maxLevel: number,
): GpuSpatialIndexState {
  const packed = createPackedBuffer(data);
  const attribute = new StorageBufferAttribute(packed, 1);
  const buffer = storage(attribute, "u32", packed.length)
    .toReadOnly()
    .setName("gpuSpatialIndex");

  return {
    data,
    buffer,
    maxLevel,
    attribute,
  };
}

export function updateGpuSpatialIndexState(
  state: GpuSpatialIndexState,
  data: GpuSpatialIndexData,
  maxLevel: number,
): GpuSpatialIndexState {
  const packed = createPackedBuffer(data);
  const array = state.attribute.array as Uint32Array;
  array.set(packed);
  state.attribute.needsUpdate = true;

  const mutableState = state as {
    data: GpuSpatialIndexData;
    maxLevel: number;
  };
  mutableState.data = data;
  mutableState.maxLevel = maxLevel;

  return state;
}

export function readGpuSpatialIndexValue(
  context: GpuSpatialIndexContext,
  slot: number | Node,
  offset: number | Node,
) {
  const slotNode = typeof slot === "number" ? uint(slot) : uint(slot as Node);
  const offsetNode =
    typeof offset === "number" ? uint(offset) : uint(offset as Node);
  const index = slotNode.mul(uint(SPATIAL_INDEX_STRIDE)).add(offsetNode);
  return context.buffer.element(index).toUint();
}

export const gpuSpatialIndexStride = SPATIAL_INDEX_STRIDE;
