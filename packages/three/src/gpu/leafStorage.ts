import { storage } from "three/tsl";
import { StorageBufferAttribute } from "three/webgpu";
import type { LeafStorageState } from "../types";

export function createLeafStorage(maxNodes: number): LeafStorageState {
  const data = new Int32Array(maxNodes * 4);
  const attribute = new StorageBufferAttribute(data, 4);
  const node = storage(attribute, "i32", 1).toReadOnly().setName("leafStorage");
  return { data, attribute, node };
}
