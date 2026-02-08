import { task } from "@hello-terrain/work";
import { storage } from "three/tsl";
import { StorageBufferAttribute, StorageBufferNode } from "three/webgpu";
import { createFlatSurface, createState, LeafSet, update } from "../quadtree";
import { maxLevel, maxNodes, origin, quadtreeUpdate, rootSize } from "./params";

export interface LeafStorageState {
  data: Int32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

export const quadtreeConfigTask = task((get, work) => {
  const rootSizeVal = get(rootSize);
  const originVal = get(origin);
  const maxNodesVal = get(maxNodes);
  const maxLevelVal = get(maxLevel);

  return work(() => {
    const surface = createFlatSurface({
      rootSize: rootSizeVal,
      origin: originVal,
    });
    const state = createState({ maxNodes: maxNodesVal, maxLevel: maxLevelVal }, surface);
    return {
      state,
      surface,
    };
  });
}).displayName("quadtreeConfigTask");

export const quadtreeUpdateTask = task((get, work) => {
  const quadtreeConfig = get(quadtreeConfigTask);
  const quadtreeUpdateConfig = get(quadtreeUpdate);

  let outLeaves: LeafSet | undefined = undefined;
  return work(() => {
    outLeaves = update(
      quadtreeConfig.state,
      quadtreeConfig.surface,
      quadtreeUpdateConfig,
      outLeaves,
    );
    return outLeaves;
  });
}).displayName("quadtreeUpdateTask");

/**
 * Creates the GPU storage buffer objects. Recreated when maxNodes changes.
 *
 * terrainVertextPositionNodeTask depends on this (not leafGpuBufferTask) so
 * the shader is only rebuilt when the buffer is resized, not on every
 * quadtree update.
 */
export const leafStorageTask = task((get, work) => {
  const maxNodesVal = get(maxNodes);
  return work(() => {
    const data = new Int32Array(maxNodesVal * 4);
    const attribute = new StorageBufferAttribute(data, 4);
    const node = storage(attribute, "i32", 1).toReadOnly().setName("leafStorage");
    return { data, attribute, node };
  });
}).displayName("leafStorageTask");

export const leafGpuBufferTask = task((get, work) => {
  const leafSet = get(quadtreeUpdateTask);
  const leafStorage = get(leafStorageTask);
  return work(() => {
    const bufferCapacity = leafStorage.data.length / 4;
    const leafCount = Math.min(leafSet.count, bufferCapacity);
    for (let i = 0; i < leafCount; i += 1) {
      const offset = i * 4;
      leafStorage.data[offset] = leafSet.level[i] ?? 0;
      leafStorage.data[offset + 1] = leafSet.x[i] ?? 0;
      leafStorage.data[offset + 2] = leafSet.y[i] ?? 0;
      leafStorage.data[offset + 3] = 1;
    }
    leafStorage.attribute.needsUpdate = true;
    leafStorage.node.needsUpdate = true;
    return {
      count: leafCount,
      data: leafStorage.data,
      attribute: leafStorage.attribute,
      node: leafStorage.node,
    };
  });
}).displayName("leafGpuBufferTask");
