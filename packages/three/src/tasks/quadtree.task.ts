import { task } from "@hello-terrain/work";
import { storage } from "three/tsl";
import { StorageBufferAttribute, StorageBufferNode } from "three/webgpu";
import {
  maxLevelParam,
  maxNodesParam,
  originParam,
  quadtreeUpdateParams,
  rootSizeParam,
} from "../params";
import { createFlatSurface, createState, LeafSet, update } from "../quadtree";

export interface LeafStorageState {
  data: Int32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

export const quadtreeConfigTask = task((get, work) => {
  const rootSize = get(rootSizeParam);
  const origin = get(originParam);
  const maxNodes = get(maxNodesParam);
  const maxLevel = get(maxLevelParam);

  return work(() => {
    const surface = createFlatSurface({
      rootSize,
      origin,
    });
    const state = createState({ maxNodes, maxLevel }, surface);
    return {
      state,
      surface,
    };
  });
}).displayName("quadtreeConfigTask");

export const quadtreeUpdateTask = task((get, work) => {
  const quadtreeConfig = get(quadtreeConfigTask);
  const quadtreeUpdateConfig = get(quadtreeUpdateParams);

  let outLeaves: LeafSet | undefined = undefined;
  // TODO: update work library to pass the prev value to the work fn like work(prev => {}) ??
  // this will mean the user needs to set the type with task<Out>() which... idk
  return work(() => {
    outLeaves = update(
      quadtreeConfig.state,
      quadtreeConfig.surface,
      quadtreeUpdateConfig,
      outLeaves, // don't create
    );
    return outLeaves;
  });
}).displayName("quadtreeUpdateTask");

export const leafStorageTask = task((get, work) => {
  const maxNodes = get(maxNodesParam);
  return work(() => {
    const data = new Int32Array(maxNodes * 4);
    const attribute = new StorageBufferAttribute(data, 4);
    const node = storage(attribute, "i32", 1).toReadOnly();
    return { data, attribute, node };
  });
}).displayName("leafStorageTask");

export const leafGpuBufferTask = task((get, work) => {
  const leafSet = get(quadtreeUpdateTask);
  const leafStorage = get(leafStorageTask);
  const maxNodes = get(maxNodesParam);
  return work(() => {
    const leafCount = Math.min(leafSet.count, maxNodes);
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
      data: leafStorage.data,
      attribute: leafStorage.attribute,
      node: leafStorage.node,
    };
  });
}).displayName("leafGpuBufferTask");
