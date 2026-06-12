import { task } from "@hello-terrain/work";
import { Vector3 } from "three";
import { createLeafStorage } from "../gpu/leafStorage";
import type { LeafSet, SpatialIndex } from "../quadtree";
import {
  buildCoarseEdgeMask,
  createFlatTopology,
  createSpatialIndex,
  createState,
  update,
} from "../quadtree";
import type { QuadtreeConfigState } from "./graph.types";
import { maxLevel, maxNodes, origin, quadtreeUpdate, rootSize, topology } from "./params";
import { terrainQueryTask } from "./terrain-query.task";

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
  const { query: terrainQuery, sphereQuery } = get(terrainQueryTask);

  let outLeaves: LeafSet | undefined = undefined;
  const cameraPosition = new Vector3();
  return work(() => {
    const cam = quadtreeUpdateConfig.cameraOrigin;
    // Terrain elevation beneath the camera drives the surface-relative LOD
    // offset applied in `update()`. On a cube sphere this is the radial
    // displacement at the camera's direction; on a flat topology it is the
    // height at the camera's XZ.
    if (sphereQuery) {
      cameraPosition.set(cam.x, cam.y, cam.z);
      quadtreeUpdateConfig.elevationAtCameraXZ =
        sphereQuery.getElevationByPosition(cameraPosition) ?? 0;
    } else {
      quadtreeUpdateConfig.elevationAtCameraXZ = terrainQuery.getElevation(cam.x, cam.z) ?? 0;
    }

    outLeaves = update(
      quadtreeConfig.state,
      quadtreeConfig.topology,
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
  const quadtreeConfig = get(quadtreeConfigTask);
  const maxNodesVal = get(maxNodes);

  // Per-frame scratch for the coarse-neighbor edge mask (allocated once).
  const edgeMask = new Uint8Array(maxNodesVal);
  const maskIndex: SpatialIndex = createSpatialIndex(maxNodesVal);

  return work(() => {
    const bufferCapacity = leafStorage.data.length / 4;
    const leafCount = Math.min(leafSet.count, bufferCapacity);

    // Edges whose neighbor is one level coarser need T-junction stitching on
    // this (finer) tile. Computed CPU-side and packed into the spare high bits
    // of slot 3 alongside the face index.
    buildCoarseEdgeMask(quadtreeConfig.topology, leafSet, edgeMask, maskIndex);

    for (let i = 0; i < leafCount; i += 1) {
      const offset = i * 4;
      leafStorage.data[offset] = leafSet.level[i] ?? 0;
      leafStorage.data[offset + 1] = leafSet.x[i] ?? 0;
      leafStorage.data[offset + 2] = leafSet.y[i] ?? 0;
      // Slot 3 packs the surface space/face index (0 for flat, 0..5 for
      // cube-sphere faces) in bits 0..2 and the 4-bit coarse-neighbor edge mask
      // (LEFT,RIGHT,TOP,BOTTOM) in bits 3..6. Decoded by `decodeLeafTile`.
      const space = leafSet.space[i] ?? 0;
      leafStorage.data[offset + 3] = (space & 0x7) | ((edgeMask[i] ?? 0) << 3);
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
