import { Fn, If, float, globalId, int, uint, uniform, vec2, workgroupBarrier } from "three/tsl";
import type { Node, WebGPURenderer } from "three/webgpu";

export type ComputeStageCallback = (
  nodeIndex: Node,
  globalVertexIndex: Node,
  uv: Node,
  localCoordinates: Node,
  texelSize: Node,
) => void;

export type ComputePipeline = ComputeStageCallback[];

const WORKGROUP_X = 16;
const WORKGROUP_Y = 16;

export function compileComputePipeline(
  stages: ComputePipeline,
  width: number,
  bindings?: Node[],
): { execute: (renderer: WebGPURenderer, instanceCount: number) => void } {
  const workgroupSize: [number, number, number] = [WORKGROUP_X, WORKGROUP_Y, 1];
  const dispatchX = Math.ceil(width / WORKGROUP_X);
  const dispatchY = Math.ceil(width / WORKGROUP_Y);
  const uInstanceCount = uniform(0, "uint");

  const computeShader = Fn(() => {
    bindings?.forEach((b) => b.toVar());

    const fWidth = float(width);
    const activeIndex = globalId.z;
    const nodeIndex = int(activeIndex).toVar();
    const iWidth = int(width);
    const ix = int(globalId.x);
    const iy = int(globalId.y);

    const texelSize = vec2(1, 1).div(fWidth);
    const localCoordinates = vec2(globalId.x, globalId.y);
    const localUVCoords = localCoordinates.div(fWidth);
    const verticesPerNode = iWidth.mul(iWidth);
    const globalIndex = int(nodeIndex).mul(verticesPerNode).add(iy.mul(iWidth).add(ix));

    const inBounds = ix
      .lessThan(iWidth)
      .and(iy.lessThan(iWidth))
      .and(uint(activeIndex).lessThan(uInstanceCount))
      .toVar();

    for (let i = 0; i < stages.length; i++) {
      if (i > 0) {
        workgroupBarrier();
      }
      If(inBounds, () => {
        stages[i](nodeIndex, globalIndex, localUVCoords, localCoordinates, texelSize);
      });
    }
  })().computeKernel(workgroupSize);

  function execute(renderer: WebGPURenderer, instanceCount: number) {
    uInstanceCount.value = instanceCount;
    renderer.compute(computeShader, [dispatchX, dispatchY, instanceCount]);
  }

  return { execute };
}
