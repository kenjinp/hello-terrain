import { task } from "@hello-terrain/work";
import { createLeafStorage } from "../gpu/leafStorage";
import { createState, update } from "../quadtree";
import type { LeafSet } from "../quadtree";
import type { LeafStorageState } from "../types";
import { maxLevel, maxNodes, quadtreeUpdate, surface } from "./params";

export const quadtreeConfigTask = task((get, work) => {
  const surfaceVal = get(surface);
  const maxNodesVal = get(maxNodes);
  const maxLevelVal = get(maxLevel);

  return work(() => {
    const state = createState({ maxNodes: maxNodesVal, maxLevel: maxLevelVal }, surfaceVal);
    return {
      state,
      surface: surfaceVal,
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
 * positionNodeTask depends on this (not leafGpuBufferTask) so
 * the shader is only rebuilt when the buffer is resized, not on every
 * quadtree update.
 */
export const leafStorageTask = task((get, work) => {
  const maxNodesVal = get(maxNodes);
  return work(() => createLeafStorage(maxNodesVal));
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
