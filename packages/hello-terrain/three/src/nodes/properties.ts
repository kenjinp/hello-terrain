import { StorageBufferAttribute } from "three/src/Three.WebGPU.js";
import { storage } from "three/tsl";

// Initialize with proper default values that match the expected structure
const dummyNodeStorage = new StorageBufferAttribute(new Float32Array(4), 4);
const dummyHeightmapStorage = new StorageBufferAttribute(
  new Float32Array(1),
  1
);
const dummyNormalmapStorage = new StorageBufferAttribute(
  new Float32Array(3),
  3
);
const dummyActiveLeafIndicesStorage = new StorageBufferAttribute(
  new Uint16Array(1),
  1
);
const dummyControlmapStorage = new StorageBufferAttribute(
  new Uint32Array(1),
  1
);
export const nodeStorageProperty = storage(
  dummyNodeStorage,
  "i32",
  1
).toReadOnly();
export const heightmapStorageProperty = storage(
  dummyHeightmapStorage,
  "f32",
  1
).toReadOnly();
export const normalmapStorageProperty = storage(
  dummyNormalmapStorage,
  "f32",
  3
).toReadOnly();
export const activeLeafIndicesStorageProperty = storage(
  dummyActiveLeafIndicesStorage,
  "u32",
  1
).toReadOnly();
export const controlmapStorageProperty = storage(
  dummyControlmapStorage,
  "u32",
  1
).toReadOnly();
