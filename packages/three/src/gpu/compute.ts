import {
  Fn,
  If,
  float,
  globalId,
  int,
  uint,
  uniform,
  vec2,
  workgroupBarrier,
} from "three/tsl";
import type { Node, WebGPURenderer } from "three/webgpu";
import { getDeviceComputeLimits } from "./deviceLimits";

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

export type CompileComputePipelineOptions = {
  bindings?: Node[];
  workgroupSize?: [number, number];
  preferSingleKernelWhenPossible?: boolean;
};

type CompiledKernel = any;

export function compileComputePipeline(
  stages: ComputePipeline,
  width: number,
  options?: CompileComputePipelineOptions,
): { execute: (renderer: WebGPURenderer, instanceCount: number) => void } {
  const bindings = options?.bindings;
  const preferredWorkgroup = options?.workgroupSize ?? [
    WORKGROUP_X,
    WORKGROUP_Y,
  ];
  const preferSingleKernelWhenPossible =
    options?.preferSingleKernelWhenPossible ?? true;
  const uInstanceCount = uniform(0, "uint");
  let singleKernel: CompiledKernel | undefined;
  const stagedKernelCache = new Map<string, CompiledKernel[]>();

  function canRunSingleKernel(
    widthValue: number,
    limits: ReturnType<typeof getDeviceComputeLimits>,
  ) {
    return (
      widthValue <= limits.maxWorkgroupSizeX &&
      widthValue <= limits.maxWorkgroupSizeY &&
      widthValue * widthValue <= limits.maxWorkgroupInvocations
    );
  }

  function clampWorkgroupToLimits(
    requested: [number, number],
    limits: ReturnType<typeof getDeviceComputeLimits>,
  ): [number, number] {
    let x = Math.max(1, Math.floor(requested[0]));
    let y = Math.max(1, Math.floor(requested[1]));

    x = Math.min(x, limits.maxWorkgroupSizeX);
    y = Math.min(y, limits.maxWorkgroupSizeY);

    y = Math.min(
      y,
      Math.max(1, Math.floor(limits.maxWorkgroupInvocations / x)),
    );
    x = Math.min(
      x,
      Math.max(1, Math.floor(limits.maxWorkgroupInvocations / y)),
    );

    return [x, y];
  }

  function buildSingleKernel(workgroupSize: [number, number, number]) {
    return Fn(() => {
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
      const globalIndex = int(nodeIndex)
        .mul(verticesPerNode)
        .add(iy.mul(iWidth).add(ix));

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
          stages[i](
            nodeIndex,
            globalIndex,
            localUVCoords,
            localCoordinates,
            texelSize,
          );
        });
      }
    })().computeKernel(workgroupSize);
  }

  function buildStagedKernels(workgroupSize: [number, number, number]) {
    return stages.map((stage) =>
      Fn(() => {
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
        const globalIndex = int(nodeIndex)
          .mul(verticesPerNode)
          .add(iy.mul(iWidth).add(ix));

        const inBounds = ix
          .lessThan(iWidth)
          .and(iy.lessThan(iWidth))
          .and(uint(activeIndex).lessThan(uInstanceCount))
          .toVar();

        If(inBounds, () => {
          stage(
            nodeIndex,
            globalIndex,
            localUVCoords,
            localCoordinates,
            texelSize,
          );
        });
      })().computeKernel(workgroupSize),
    );
  }

  function execute(renderer: WebGPURenderer, instanceCount: number) {
    const limits = getDeviceComputeLimits(renderer);
    const canUseSingleKernel =
      preferSingleKernelWhenPossible && canRunSingleKernel(width, limits);
    uInstanceCount.value = instanceCount;

    if (canUseSingleKernel) {
      if (!singleKernel) {
        singleKernel = buildSingleKernel([width, width, 1]);
      }
      renderer.compute(singleKernel, [1, 1, instanceCount]);
      return;
    }

    const [workgroupX, workgroupY] = clampWorkgroupToLimits(
      preferredWorkgroup,
      limits,
    );
    const cacheKey = `${workgroupX}x${workgroupY}`;
    let stagedKernels = stagedKernelCache.get(cacheKey);
    if (!stagedKernels) {
      stagedKernels = buildStagedKernels([workgroupX, workgroupY, 1]);
      stagedKernelCache.set(cacheKey, stagedKernels);
    }

    const dispatchX = Math.ceil(width / workgroupX);
    const dispatchY = Math.ceil(width / workgroupY);
    for (const kernel of stagedKernels) {
      renderer.compute(kernel, [dispatchX, dispatchY, instanceCount]);
    }
  }

  return { execute };
}
