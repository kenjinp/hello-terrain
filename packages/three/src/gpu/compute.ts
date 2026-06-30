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
import type { VisibleSlotStorageState } from "../types";
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
  dispatchMode?: "linear" | "tile-grid";
  instanceSource?: "active-index" | "dirty-visible-slot";
  dirtyVisibleSlotStorage?: VisibleSlotStorageState;
  preferSingleKernelWhenPossible?: boolean;
  /**
   * Human-readable name stamped onto the generated compute kernel(s). Three's
   * WebGPU backend uses `computeNode.name` as the shader-module label
   * (`compute_<name>`), so setting it makes GPU captures (Xcode/Metal,
   * chrome://tracing) attributable instead of a wall of anonymous `compute`
   * passes. Staged kernels are suffixed `<label>.stage<i>`.
   */
  label?: string;
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
  const label = options?.label;
  const instanceSource = options?.instanceSource ?? "active-index";
  const dirtyVisibleSlotStorage = options?.dirtyVisibleSlotStorage;
  const uInstanceCount = uniform(0, "uint").setName("uInstanceCount");
  const uTotalVertexCount = uniform(0, "uint").setName("uTotalVertexCount");
  let singleKernel: CompiledKernel | undefined;
  const stagedKernelCache = new Map<string, CompiledKernel[]>();
  const linearStagedKernelCache = new Map<string, CompiledKernel[]>();

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

  function fieldSlotForDispatchIndex(dispatchIndex: Node): Node {
    if (instanceSource === "dirty-visible-slot") {
      if (!dirtyVisibleSlotStorage) {
        throw new Error(
          "dirtyVisibleSlotStorage is required for dirty-visible-slot compute.",
        );
      }
      return dirtyVisibleSlotStorage.node.element(int(dispatchIndex)).toInt();
    }
    return int(dispatchIndex);
  }

  function buildSingleKernel(workgroupSize: [number, number, number]) {
    return Fn(() => {
      bindings?.forEach((b) => b.toVar());

      const fWidth = float(width);
      const activeIndex = globalId.z;
      const nodeIndex = fieldSlotForDispatchIndex(activeIndex).toVar();
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
    })()
      .computeKernel(workgroupSize)
      .setName(label ?? "compute");
  }

  function buildStagedKernels(workgroupSize: [number, number, number]) {
    return stages.map((stage, stageIndex) =>
      Fn(() => {
        bindings?.forEach((b) => b.toVar());

        const fWidth = float(width);
        const activeIndex = globalId.z;
        const nodeIndex = fieldSlotForDispatchIndex(activeIndex).toVar();
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
      })()
        .computeKernel(workgroupSize)
        .setName(label ? `${label}.stage${stageIndex}` : `compute.stage${stageIndex}`),
    );
  }

  function buildLinearStagedKernels(workgroupSize: [number, number, number]) {
    return stages.map((stage, stageIndex) =>
      Fn(() => {
        bindings?.forEach((b) => b.toVar());

        const fWidth = float(width);
        const iWidth = int(width);
        const verticesPerNode = iWidth.mul(iWidth);
        const linearIndex = int(globalId.x).toVar();
        const dispatchIndex = int(linearIndex.div(verticesPerNode)).toVar();
        const nodeIndex = fieldSlotForDispatchIndex(dispatchIndex).toVar();
        const localIndex = int(linearIndex.mod(verticesPerNode));
        const ix = int(localIndex.mod(iWidth));
        const iy = int(localIndex.div(iWidth));

        const texelSize = vec2(1, 1).div(fWidth);
        const localCoordinates = vec2(ix.toFloat(), iy.toFloat());
        const localUVCoords = localCoordinates.div(fWidth);

        const inBounds = uint(linearIndex)
          .lessThan(uTotalVertexCount)
          .toVar();

        If(inBounds, () => {
          const globalIndex = int(nodeIndex)
            .mul(verticesPerNode)
            .add(localIndex);
          stage(
            nodeIndex,
            globalIndex,
            localUVCoords,
            localCoordinates,
            texelSize,
          );
        });
      })()
        .computeKernel(workgroupSize)
        .setName(label ? `${label}.linearStage${stageIndex}` : `compute.linearStage${stageIndex}`),
    );
  }

  function execute(renderer: WebGPURenderer, instanceCount: number) {
    if (instanceCount <= 0) return;
    const limits = getDeviceComputeLimits(renderer);
    const canUseSingleKernel =
      preferSingleKernelWhenPossible && canRunSingleKernel(width, limits);
    uInstanceCount.value = instanceCount;
    const verticesPerNode = width * width;
    uTotalVertexCount.value = instanceCount * verticesPerNode;

    if (canUseSingleKernel) {
      if (!singleKernel) {
        singleKernel = buildSingleKernel([width, width, 1]);
      }
      renderer.compute(singleKernel, [1, 1, instanceCount]);
      return;
    }

    const dispatchMode = options?.dispatchMode ?? "linear";
    const [workgroupX, workgroupY] = clampWorkgroupToLimits(
      preferredWorkgroup,
      limits,
    );
    if (dispatchMode === "linear") {
      const linearWorkgroupX = Math.min(
        limits.maxWorkgroupSizeX,
        limits.maxWorkgroupInvocations,
        Math.max(1, workgroupX * workgroupY),
      );
      const cacheKey = `${linearWorkgroupX}`;
      let stagedKernels = linearStagedKernelCache.get(cacheKey);
      if (!stagedKernels) {
        stagedKernels = buildLinearStagedKernels([linearWorkgroupX, 1, 1]);
        linearStagedKernelCache.set(cacheKey, stagedKernels);
      }

      const dispatchX = Math.ceil((instanceCount * verticesPerNode) / linearWorkgroupX);
      for (const kernel of stagedKernels) {
        renderer.compute(kernel, [dispatchX, 1, 1]);
      }
      return;
    }

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
