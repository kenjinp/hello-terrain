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
import type { ComputeNode, Node, WebGPURenderer } from "three/webgpu";
import { type ComputeDeviceLimits, getDeviceComputeLimits } from "./deviceLimits";

/**
 * One stage of a terrain compute pipeline. Invoked once per grid texel of
 * every active leaf tile (out-of-range invocations are masked off before the
 * callback runs). The grid is `width × width` texels, where
 * `width = innerTileSegments + 3` (see `FIELD_EDGE_EXTRA_TEXELS`): the inner
 * tile grid plus a 1-texel skirt ring on every side.
 *
 * @param nodeIndex        `int` — leaf slot index in `[0, instanceCount)`.
 *                         Indexes leaf storage (`decodeLeafTile`) and the
 *                         per-tile bounds buffers.
 * @param globalVertexIndex `int` — flat texel index into per-vertex field
 *                         buffers: `nodeIndex * width² + iy * width + ix`.
 * @param uv               `vec2` — `localCoordinates / width`. Spans the WHOLE
 *                         grid including the skirt ring; it starts at `0` on
 *                         the first skirt texel and reaches at most
 *                         `(width - 1) / width`, never `1.0`. This is *not*
 *                         the inner-grid `[0, 1]` UV produced by
 *                         `tileFaceUV` / `tileLocalToFieldUV`; use those when
 *                         you need face-relative or texture-sampling UVs.
 * @param localCoordinates `vec2` — integer texel coordinates `(ix, iy)` in
 *                         `[0, width)`. `0` and `width - 1` are skirt texels;
 *                         `1 .. width - 2` are the inner grid.
 * @param texelSize        `vec2` — `1 / width` on both axes; the step between
 *                         adjacent `uv` values.
 */
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
  /** Workgroup size for staged kernels; clamped to device limits. Default `[16, 16]`. */
  workgroupSize?: [number, number];
  /**
   * When `true` (the default) and the tile grid fits in one workgroup on the
   * current device, all stages are fused into a single kernel separated by
   * `workgroupBarrier()`. Ignored when `midPipelineExecute` is set: the
   * mid-pipeline hook must run between two separate dispatches, so the staged
   * path is always used in that case.
   */
  preferSingleKernelWhenPossible?: boolean;
  /**
   * Runs after all but the last stage, i.e. between the second-to-last and
   * last stage dispatches. Providing this forces the staged kernel path so the
   * hook is never skipped (see `preferSingleKernelWhenPossible`). Only
   * invoked when the pipeline has at least two stages.
   */
  midPipelineExecute?: (renderer: WebGPURenderer, instanceCount: number) => void;
};

type CompiledKernel = ComputeNode;

/**
 * Per-invocation values shared by every stage kernel: which leaf we are in,
 * which texel, and whether this invocation is inside the tile grid at all.
 */
type InvocationContext = {
  nodeIndex: Node;
  globalIndex: Node;
  localUVCoords: Node;
  localCoordinates: Node;
  texelSize: Node;
  inBounds: Node;
};

/**
 * Pure TSL builder for the per-invocation context. Must be called inside a
 * `Fn` body; reads `globalId` and the shared `uInstanceCount` uniform.
 */
function buildInvocationContext(width: number, uInstanceCount: Node): InvocationContext {
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

  return { nodeIndex, globalIndex, localUVCoords, localCoordinates, texelSize, inBounds };
}

function runStage(stage: ComputeStageCallback, ctx: InvocationContext): void {
  If(ctx.inBounds, () => {
    stage(ctx.nodeIndex, ctx.globalIndex, ctx.localUVCoords, ctx.localCoordinates, ctx.texelSize);
  });
}

export function compileComputePipeline(
  stages: ComputePipeline,
  width: number,
  options?: CompileComputePipelineOptions,
): { execute: (renderer: WebGPURenderer, instanceCount: number) => void } {
  const bindings = options?.bindings;
  const preferredWorkgroup = options?.workgroupSize ?? [WORKGROUP_X, WORKGROUP_Y];
  const preferSingleKernelWhenPossible = options?.preferSingleKernelWhenPossible ?? true;
  const midPipelineExecute = options?.midPipelineExecute;
  const uInstanceCount = uniform(0, "uint").setName("uInstanceCount");
  let singleKernel: CompiledKernel | undefined;
  const stagedKernelCache = new Map<string, CompiledKernel[]>();
  // Device limits are immutable for a given device; cache per renderer so
  // execute() does not re-read the backend every frame.
  const limitsByRenderer = new WeakMap<WebGPURenderer, ComputeDeviceLimits>();

  function getLimits(renderer: WebGPURenderer): ComputeDeviceLimits {
    let limits = limitsByRenderer.get(renderer);
    if (!limits) {
      limits = getDeviceComputeLimits(renderer);
      limitsByRenderer.set(renderer, limits);
    }
    return limits;
  }

  function canRunSingleKernel(widthValue: number, limits: ComputeDeviceLimits) {
    return (
      widthValue <= limits.maxWorkgroupSizeX &&
      widthValue <= limits.maxWorkgroupSizeY &&
      widthValue * widthValue <= limits.maxWorkgroupInvocations
    );
  }

  function clampWorkgroupToLimits(
    requested: [number, number],
    limits: ComputeDeviceLimits,
  ): [number, number] {
    let x = Math.max(1, Math.floor(requested[0]));
    let y = Math.max(1, Math.floor(requested[1]));

    x = Math.min(x, limits.maxWorkgroupSizeX);
    y = Math.min(y, limits.maxWorkgroupSizeY);

    y = Math.min(y, Math.max(1, Math.floor(limits.maxWorkgroupInvocations / x)));
    x = Math.min(x, Math.max(1, Math.floor(limits.maxWorkgroupInvocations / y)));

    return [x, y];
  }

  function buildSingleKernel(workgroupSize: [number, number, number]): CompiledKernel {
    return Fn(() => {
      bindings?.forEach((b) => b.toVar());
      const ctx = buildInvocationContext(width, uInstanceCount);

      for (let i = 0; i < stages.length; i++) {
        if (i > 0) {
          workgroupBarrier();
        }
        runStage(stages[i], ctx);
      }
    })().computeKernel(workgroupSize);
  }

  function buildStagedKernels(workgroupSize: [number, number, number]): CompiledKernel[] {
    return stages.map((stage) =>
      Fn(() => {
        bindings?.forEach((b) => b.toVar());
        const ctx = buildInvocationContext(width, uInstanceCount);
        runStage(stage, ctx);
      })().computeKernel(workgroupSize),
    );
  }

  function execute(renderer: WebGPURenderer, instanceCount: number) {
    const limits = getLimits(renderer);
    // A mid-pipeline hook needs a dispatch boundary between stages, which the
    // fused single kernel cannot provide, so it always takes the staged path.
    const canUseSingleKernel =
      preferSingleKernelWhenPossible && !midPipelineExecute && canRunSingleKernel(width, limits);
    uInstanceCount.value = instanceCount;

    if (canUseSingleKernel) {
      if (!singleKernel) {
        singleKernel = buildSingleKernel([width, width, 1]);
      }
      renderer.compute(singleKernel, [1, 1, instanceCount]);
      return;
    }

    const [workgroupX, workgroupY] = clampWorkgroupToLimits(preferredWorkgroup, limits);
    const cacheKey = `${workgroupX}x${workgroupY}`;
    let stagedKernels = stagedKernelCache.get(cacheKey);
    if (!stagedKernels) {
      stagedKernels = buildStagedKernels([workgroupX, workgroupY, 1]);
      stagedKernelCache.set(cacheKey, stagedKernels);
    }

    const dispatchX = Math.ceil(width / workgroupX);
    const dispatchY = Math.ceil(width / workgroupY);
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

  return { execute };
}
