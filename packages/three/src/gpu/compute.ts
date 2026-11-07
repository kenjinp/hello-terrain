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
  /** Known intermediate GPU work eligible for ordered, single-submission dispatch. */
  midPipelineCompute?: {
    kernel: CompiledKernel;
    dispatchSize: (instanceCount: number) => [number, number, number];
  };
  /** Runs after all but the last stage when using staged kernels. Takes precedence over batching. */
  midPipelineExecute?: (renderer: WebGPURenderer, instanceCount: number) => void;
};

type CompiledKernel = any;

export function compileComputePipeline(
  stages: ComputePipeline,
  width: number,
  options?: CompileComputePipelineOptions,
): { execute: (renderer: WebGPURenderer, instanceCount: number) => void; dispose(): void } {
  const bindings = options?.bindings;
  const preferredWorkgroup = options?.workgroupSize ?? [
    WORKGROUP_X,
    WORKGROUP_Y,
  ];
  const preferSingleKernelWhenPossible =
    options?.preferSingleKernelWhenPossible ?? true;
  const midPipelineExecute = options?.midPipelineExecute;
  const midPipelineCompute = options?.midPipelineCompute;
  const uInstanceCount = uniform(0, "uint").setName("uInstanceCount");
  let singleKernel: CompiledKernel | undefined;
  const stagedKernelCache = new Map<string, CompiledKernel[]>();
  // Three caches its compute group by array identity; retain this array too.
  const orderedKernelCache = new Map<string, CompiledKernel[]>();

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
      preferSingleKernelWhenPossible && !midPipelineCompute && canRunSingleKernel(width, limits);
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
    if (midPipelineCompute && !midPipelineExecute && stagedKernels.length > 1) {
      if (instanceCount <= 0) return;
      for (const kernel of stagedKernels) kernel.count = [dispatchX, dispatchY, instanceCount];
      midPipelineCompute.kernel.count = midPipelineCompute.dispatchSize(instanceCount);
      let ordered = orderedKernelCache.get(cacheKey);
      if (!ordered) {
        ordered = [
          ...stagedKernels.slice(0, -1),
          midPipelineCompute.kernel,
          stagedKernels[stagedKernels.length - 1],
        ];
        orderedKernelCache.set(cacheKey, ordered);
      }
      // Separate ordered dispatches retain global storage dependencies. This is
      // submission batching, not shader fusion or workgroup-local synchronization.
      // Omit the dispatch override: Three uses each kernel's own count tuple.
      renderer.compute(ordered);
      return;
    }
    for (let stageIndex = 0; stageIndex < stagedKernels.length; stageIndex += 1) {
      renderer.compute(stagedKernels[stageIndex], [dispatchX, dispatchY, instanceCount]);
      if (
        midPipelineExecute &&
        stagedKernels.length > 1 &&
        stageIndex === stagedKernels.length - 2
      ) {
        midPipelineExecute(renderer, instanceCount);
      }
    }
  }

  return { execute, dispose() {
    singleKernel?.dispose();
    for (const kernels of stagedKernelCache.values()) for (const kernel of kernels) kernel.dispose();
    stagedKernelCache.clear(); orderedKernelCache.clear(); singleKernel = undefined;
  } };
}
