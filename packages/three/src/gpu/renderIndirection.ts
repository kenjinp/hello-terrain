import { storage } from "three/tsl";
import {
  IndirectStorageBufferAttribute,
  StorageBufferAttribute,
} from "three/webgpu";
import type { StorageBufferNode } from "three/webgpu";

export interface RenderIndirectionState {
  data: Int32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
  visibleCounterData: Uint32Array<ArrayBuffer>;
  visibleCounterAttribute: StorageBufferAttribute;
  visibleCounterNode: StorageBufferNode;
  indirectData: Uint32Array<ArrayBuffer>;
  indirectAttribute: IndirectStorageBufferAttribute;
  indirectNode: StorageBufferNode;
  indexCount: number;
}

export function getTerrainIndexCount(innerTileSegments: number): number {
  const cellsPerEdge = innerTileSegments + 2;
  return cellsPerEdge * cellsPerEdge * 6;
}

export function createRenderIndirection(
  maxNodes: number,
  innerTileSegments: number,
): RenderIndirectionState {
  const data = new Int32Array(maxNodes);
  const attribute = new StorageBufferAttribute(data, 1);
  const node = storage(attribute, "i32", maxNodes).setName(
    "renderIndirection",
  ) as StorageBufferNode;

  const visibleCounterData = new Uint32Array([0]);
  const visibleCounterAttribute = new StorageBufferAttribute(visibleCounterData, 1);
  const visibleCounterNode = storage(
    visibleCounterAttribute,
    "u32",
    1,
  )
    .toAtomic()
    .setName("renderVisibleCounter") as StorageBufferNode;

  const indexCount = getTerrainIndexCount(innerTileSegments);
  const indirectData = new Uint32Array([indexCount, 0, 0, 0, 0]);
  const indirectAttribute = new IndirectStorageBufferAttribute(indirectData, 5);
  const indirectNode = storage(indirectAttribute, "u32", 5).setName(
    "renderIndirect",
  ) as StorageBufferNode;

  return {
    data,
    attribute,
    node,
    visibleCounterData,
    visibleCounterAttribute,
    visibleCounterNode,
    indirectData,
    indirectAttribute,
    indirectNode,
    indexCount,
  };
}
