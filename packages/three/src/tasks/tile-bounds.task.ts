import { task } from "@hello-terrain/work";
import { Fn, If, Loop, float, int, localId, max, min, storage, uint, workgroupArray, workgroupBarrier, workgroupId } from "three/tsl";
import type { StorageBufferNode } from "three/webgpu";
import { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { executeComputeTask } from "./compute.task";
import { createElevationFieldContextTask } from "./elevation-field.task";
import { innerTileSegments, maxNodes } from "./params";
import {
  dirtyVisibleSlotBufferTask,
  dirtyVisibleSlotStorageTask,
} from "./quadtree.task";

export interface TileBoundsContext {
  data: Float32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

const WGSIZE = 64;

function buildReductionKernel(
  elevationFieldNode: StorageBufferNode,
  boundsNode: StorageBufferNode,
  dirtyVisibleSlotNode: StorageBufferNode,
  verticesPerNode: number,
  edgeVertexCount: number,
) {
  const elemsPerThread = Math.ceil(verticesPerNode / WGSIZE);

  return Fn(() => {
    const sharedMin = workgroupArray("float", WGSIZE);
    const sharedMax = workgroupArray("float", WGSIZE);

    const tid = int(localId.x);
    const dispatchIndex = uint(workgroupId.z);
    const fieldSlot = dirtyVisibleSlotNode.element(dispatchIndex).toUint();
    const baseOffset = fieldSlot.mul(uint(verticesPerNode));

    const start = tid.mul(int(elemsPerThread));
    const end = min(start.add(int(elemsPerThread)), int(verticesPerNode));

    const localMin = float(1e10).toVar("localMin");
    const localMax = float(-1e10).toVar("localMax");

    // Bounds describe the real surface relief, so the outermost skirt ring
    // (which samples elevation outside the tile) must not widen the range.
    const edge = int(edgeVertexCount);
    const lastEdge = int(edgeVertexCount - 1);

    Loop({ start, end, type: "int", condition: "<" }, ({ i }) => {
      const ix = int(i).mod(edge);
      const iy = int(i).div(edge);
      const isSkirt = ix
        .equal(int(0))
        .or(ix.equal(lastEdge))
        .or(iy.equal(int(0)))
        .or(iy.equal(lastEdge));
      If(isSkirt.not(), () => {
        const h = elevationFieldNode.element(int(baseOffset.add(uint(i))));
        localMin.assign(min(localMin, h));
        localMax.assign(max(localMax, h));
      });
    });

    sharedMin.element(tid).assign(localMin);
    sharedMax.element(tid).assign(localMax);

    workgroupBarrier();

    If(tid.equal(int(0)), () => {
      const finalMin = float(1e10).toVar("finalMin");
      const finalMax = float(-1e10).toVar("finalMax");

      Loop(WGSIZE, ({ i }) => {
        finalMin.assign(min(finalMin, sharedMin.element(i)));
        finalMax.assign(max(finalMax, sharedMax.element(i)));
      });

      const outIdx = fieldSlot.mul(uint(2));
      boundsNode.element(int(outIdx)).assign(finalMin);
      boundsNode.element(int(outIdx.add(uint(1)))).assign(finalMax);
    });
  })()
    .computeKernel([WGSIZE, 1, 1])
    .setName("tileBoundsReduction");
}

export const tileBoundsContextTask = task((get, work) => {
  const elevationFieldContext = get(createElevationFieldContextTask);
  const dirtyVisibleSlotStorage = get(dirtyVisibleSlotStorageTask);
  const maxNodesValue = get(maxNodes);
  const edgeVertexCount = get(innerTileSegments) + 3;

  return work((): TileBoundsContext & { kernel: ReturnType<typeof buildReductionKernel> } => {
    const data = new Float32Array(maxNodesValue * 2);
    const attribute = new StorageBufferAttribute(data, 1);
    attribute.name = "tileBounds";
    const node = storage(attribute, "float", maxNodesValue * 2).setName(
      "tileBounds",
    ) as StorageBufferNode;
    const verticesPerNode = edgeVertexCount * edgeVertexCount;
    const kernel = buildReductionKernel(
      elevationFieldContext.node,
      node,
      dirtyVisibleSlotStorage.node,
      verticesPerNode,
      edgeVertexCount,
    );
    return { data, attribute, node, kernel };
  });
}).displayName("tileBoundsContextTask");

export const tileBoundsReductionTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    get(executeComputeTask);
    const boundsContext = get(tileBoundsContextTask);
    const dirtyVisibleSlots = get(dirtyVisibleSlotBufferTask);

    return work((): TileBoundsContext => {
      if (resources?.renderer && dirtyVisibleSlots.count > 0) {
        resources.renderer.compute(boundsContext.kernel, [1, 1, dirtyVisibleSlots.count]);
      }
      return boundsContext;
    });
  },
)
  .displayName("tileBoundsReductionTask")
  .lane("gpu");
