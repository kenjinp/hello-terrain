import { task } from "@hello-terrain/work";
import { createLeafStorage } from "../gpu/leafStorage";
import type { LeafSet } from "../quadtree";
import { createFlatSurface, createState, update } from "../quadtree";
import type { QuadtreeConfigState } from "./graph.types";
import { maxLevel, maxNodes, origin, quadtreeUpdate, rootSize, surface } from "./params";
import { terrainQueryTask } from "./terrain-query.task";

/**
 * Derives the terrain surface from `rootSize` and `origin`.
 * Automatically recomputes when either param changes, keeping the
 * quadtree refinement in sync with the GPU-side tile positioning.
 */
export const surfaceTask = task((get, work) => {
  const customSurface = get(surface);
  const rootSizeVal = get(rootSize);
  const originVal = get(origin);

  return work(() => {
    if (customSurface) return customSurface;
    return createFlatSurface({ rootSize: rootSizeVal, origin: originVal });
  });
}).displayName("surfaceTask");

export const quadtreeConfigTask = task((get, work) => {
  const surfaceVal = get(surfaceTask);
  const maxNodesVal = get(maxNodes);
  const maxLevelVal = get(maxLevel);

  return work((): QuadtreeConfigState => {
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
  const { query: terrainQuery } = get(terrainQueryTask);

  let outLeaves: LeafSet | undefined = undefined;
  return work(() => {
    const cam = quadtreeUpdateConfig.cameraOrigin;
    quadtreeUpdateConfig.elevationAtCameraXZ = terrainQuery.getElevation(cam.x, cam.z) ?? 0;

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
