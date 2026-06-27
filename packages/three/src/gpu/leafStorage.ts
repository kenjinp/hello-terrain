import { storage } from "three/tsl";
import { StorageBufferAttribute } from "three/webgpu";
import type { LeafStorageState, VisibleSlotStorageState } from "../types";

export function createLeafStorage(maxNodes: number): LeafStorageState {
  const data = new Int32Array(maxNodes * 4);
  const attribute = new StorageBufferAttribute(data, 4);
  attribute.name = "slotTileStorage";
  const node = storage(attribute, "i32", 1).toReadOnly().setName("slotTileStorage");
  return { data, attribute, node };
}

export function createVisibleSlotStorage(maxNodes: number): VisibleSlotStorageState {
  const data = new Uint32Array(maxNodes);
  const attribute = new StorageBufferAttribute(data, 1);
  attribute.name = "visibleSlotStorage";
  const node = storage(attribute, "u32", 1).toReadOnly().setName("visibleSlotStorage");
  return { data, attribute, node };
}
