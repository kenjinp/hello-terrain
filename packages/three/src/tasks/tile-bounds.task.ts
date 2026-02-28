import { task } from "@hello-terrain/work";
import {
  Fn,
  If,
  Loop,
  float,
  int,
  localId,
  max,
  min,
  storage,
  workgroupId,
} from "three/tsl";
import { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import type { StorageBufferNode } from "three/webgpu";
import { innerTileSegments, maxNodes } from "./params";
import { createElevationFieldContextTask } from "./elevation-field.task";
import { executeComputeTask } from "./compute.task";
import { leafGpuBufferTask } from "./quadtree.task";

export interface TileBoundsContext {
  data: Float32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

function buildReductionKernel(
  elevationFieldNode: StorageBufferNode,
  boundsNode: StorageBufferNode,
  verticesPerNode: number,
) {
  return Fn(() => {
    const tid = int(localId.x);

    If(tid.equal(int(0)), () => {
      const tileIdx = int(workgroupId.z);
      const baseOffset = tileIdx.mul(int(verticesPerNode));

      const minVal = float(1e10).toVar("tileBoundsMin");
      const maxVal = float(-1e10).toVar("tileBoundsMax");

      Loop(verticesPerNode, ({ i }) => {
        const h = elevationFieldNode.element(baseOffset.add(int(i)));
        minVal.assign(min(minVal, h));
        maxVal.assign(max(maxVal, h));
      });

      const outIdx = tileIdx.mul(int(2));
      boundsNode.element(outIdx).assign(minVal);
      boundsNode.element(outIdx.add(int(1))).assign(maxVal);
    });
  })().computeKernel([1, 1, 1]);
}

export const tileBoundsContextTask = task((get, work) => {
  const elevationFieldContext = get(createElevationFieldContextTask);
  const maxNodesValue = get(maxNodes);
  const edgeVertexCount = get(innerTileSegments) + 3;
  const verticesPerNode = edgeVertexCount * edgeVertexCount;

  return work((): TileBoundsContext & { kernel: ReturnType<typeof buildReductionKernel> } => {
    const data = new Float32Array(maxNodesValue * 2);
    const attribute = new StorageBufferAttribute(data, 1);
    const node = storage(attribute, "float", maxNodesValue * 2) as StorageBufferNode;
    const kernel = buildReductionKernel(
      elevationFieldContext.node,
      node,
      verticesPerNode,
    );
    return { data, attribute, node, kernel };
  });
}).displayName("tileBoundsContextTask");

export const tileBoundsReductionTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    get(executeComputeTask);
    const boundsContext = get(tileBoundsContextTask);
    const leafState = get(leafGpuBufferTask);

    return work((): TileBoundsContext => {
      if (resources?.renderer && leafState.count > 0) {
        resources.renderer.compute(boundsContext.kernel, [
          1,
          1,
          leafState.count,
        ]);
      }
      return boundsContext;
    });
  },
)
  .displayName("tileBoundsReductionTask")
  .lane("gpu");
