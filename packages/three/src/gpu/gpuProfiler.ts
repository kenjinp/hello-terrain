import type { WebGPURenderer } from "three/webgpu";

/**
 * Per-frame GPU execution time, split by pass type. Durations are in
 * milliseconds and measured on the GPU timeline (not CPU submit cost), so they
 * directly answer "are we compute-bound or render-bound this frame?".
 */
export type GpuFrameTimings = {
  /** GPU time (ms) spent in render passes during the last resolved frame. */
  renderMs: number;
  /** GPU time (ms) spent in compute passes during the last resolved frame. */
  computeMs: number;
  /** `renderMs + computeMs`. */
  totalMs: number;
  /** Number of render timestamp queries submitted since the last resolve. */
  renderQueryCount: number;
  /** Number of compute timestamp queries submitted since the last resolve. */
  computeQueryCount: number;
  /** Compute dispatches captured since the previous sample. */
  computePasses: GpuComputePassTiming[];
};

export type GpuComputePassTiming = {
  uid: string | null;
  name: string;
  dispatchSize: number | [number, number, number] | "indirect" | null;
  durationMs: number | null;
};

export type GpuProfiler = {
  /**
   * Turn on timestamp tracking. Returns `true` if the device supports the
   * `timestamp-query` feature and tracking is now active, `false` otherwise.
   * Safe to call before the renderer is initialized.
   */
  enable(): boolean;
  /** Whether timestamp tracking is currently active. */
  readonly enabled: boolean;
  /**
   * Resolve the most recent frame's GPU timings. Call once per frame *after*
   * your compute + render submissions for that frame.
   *
   * Resolution is asynchronous and lags real-time by roughly one frame, so the
   * returned value describes a recently-completed frame, not the one you just
   * submitted. Returns `null` until the first resolve lands or when tracking is
   * disabled/unsupported.
   */
  sample(): Promise<GpuFrameTimings | null>;
  /**
   * Last resolved timings, for synchronous consumers like an on-screen HUD.
   * `null` until the first {@link sample} resolves.
   */
  readonly last: GpuFrameTimings | null;
  /** Restore renderer hooks installed by the profiler. */
  dispose(): void;
};

/**
 * Three's renderer surface used here. `resolveTimestampsAsync` and
 * `trackTimestamp` exist on the WebGPU renderer but are not always present in
 * the published typings, so we narrow to just what we touch.
 */
type TimestampCapableRenderer = WebGPURenderer & {
  trackTimestamp?: boolean;
  backend?: {
    trackTimestamp?: boolean;
    timestampQueryPool?: Partial<Record<"render" | "compute", TimestampQueryPoolLike | null>>;
    getTimestampUID?: (computeNodes: unknown) => string;
  };
  compute: (computeNodes: unknown, dispatchSize?: unknown) => unknown;
  resolveTimestampsAsync?: (type: "render" | "compute") => Promise<number | undefined>;
};

type TimestampQueryPoolLike = {
  currentQueryIndex?: number;
  timestamps?: Map<string, number>;
};

type PendingComputePass = Omit<GpuComputePassTiming, "durationMs">;

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampQueryCount(
  renderer: TimestampCapableRenderer,
  type: "render" | "compute",
) {
  return numberOrNull(renderer.backend?.timestampQueryPool?.[type]?.currentQueryIndex) ?? 0;
}

function computeNodeName(computeNodes: unknown) {
  const list = Array.isArray(computeNodes) ? computeNodes : [computeNodes];
  return list
    .map((node, index) => {
      const maybeNode = node as { name?: unknown; id?: unknown };
      if (typeof maybeNode.name === "string" && maybeNode.name.length > 0) {
        return maybeNode.name;
      }
      if (typeof maybeNode.id === "number") return `compute#${maybeNode.id}`;
      return `compute[${index}]`;
    })
    .join("+");
}

function computeDispatchSize(
  dispatchSize: unknown,
): GpuComputePassTiming["dispatchSize"] {
  if (typeof dispatchSize === "number") return dispatchSize;
  if (
    Array.isArray(dispatchSize) &&
    dispatchSize.length === 3 &&
    dispatchSize.every((value) => typeof value === "number")
  ) {
    return dispatchSize as [number, number, number];
  }
  if (dispatchSize == null) return null;
  return "indirect";
}

function resolveComputePassTimings(
  renderer: TimestampCapableRenderer,
  passes: PendingComputePass[],
): GpuComputePassTiming[] {
  const timestamps = renderer.backend?.timestampQueryPool?.compute?.timestamps;
  return passes.map((pass) => ({
    ...pass,
    durationMs: pass.uid ? numberOrNull(timestamps?.get(pass.uid)) : null,
  }));
}

/**
 * Wrap a {@link WebGPURenderer} with GPU timestamp profiling. Pair this with
 * named compute kernels / materials (so the slices are attributable in capture
 * tools) to find which GPU work is eating the frame budget.
 *
 * @example
 * ```ts
 * const profiler = createGpuProfiler(renderer);
 * profiler.enable();
 * // ...per frame, after compute + render:
 * const timings = await profiler.sample();
 * if (timings) console.log(`gpu render=${timings.renderMs.toFixed(2)}ms compute=${timings.computeMs.toFixed(2)}ms`);
 * ```
 */
export function createGpuProfiler(renderer: WebGPURenderer): GpuProfiler {
  const gpu = renderer as unknown as TimestampCapableRenderer;
  let last: GpuFrameTimings | null = null;
  let disposed = false;
  let wrapped = false;
  let pendingComputePasses: PendingComputePass[] = [];
  let originalCompute: TimestampCapableRenderer["compute"] | null = null;

  const wrapCompute = () => {
    if (wrapped) return;
    originalCompute = gpu.compute.bind(renderer);
    gpu.compute = ((computeNodes: unknown, dispatchSize?: unknown) => {
      const result = originalCompute!(computeNodes, dispatchSize);
      const uid = gpu.backend?.getTimestampUID?.(computeNodes);
      pendingComputePasses.push({
        uid: typeof uid === "string" ? uid : null,
        name: computeNodeName(computeNodes),
        dispatchSize: computeDispatchSize(dispatchSize),
      });
      return result;
    }) as TimestampCapableRenderer["compute"];
    wrapped = true;
  };

  const dispose = () => {
    disposed = true;
    pendingComputePasses = [];
    if (wrapped && originalCompute) {
      gpu.compute = originalCompute;
      originalCompute = null;
      wrapped = false;
    }
  };

  return {
    enable(): boolean {
      if (disposed) return false;
      // The backend clamps this to `false` during init if the device lacks the
      // `timestamp-query` feature, so reading it back reports real support.
      gpu.trackTimestamp = true;
      wrapCompute();
      return gpu.trackTimestamp === true && typeof gpu.resolveTimestampsAsync === "function";
    },
    get enabled(): boolean {
      return !disposed && gpu.trackTimestamp === true;
    },
    get last(): GpuFrameTimings | null {
      return last;
    },
    dispose,
    async sample(): Promise<GpuFrameTimings | null> {
      if (disposed || gpu.trackTimestamp !== true || !gpu.resolveTimestampsAsync) {
        return null;
      }

      const computePasses = pendingComputePasses;
      pendingComputePasses = [];
      const renderQueryCount = timestampQueryCount(gpu, "render");
      const computeQueryCount = timestampQueryCount(gpu, "compute");

      // Resolve serially: both share the renderer's pending-resolve guard, and
      // serial keeps the staging-buffer mapping uncontended.
      const renderMs =
        (renderQueryCount > 0
          ? await gpu.resolveTimestampsAsync("render")
          : undefined) ??
        last?.renderMs ??
        0;
      const computeMs =
        (computeQueryCount > 0
          ? await gpu.resolveTimestampsAsync("compute")
          : undefined) ??
        last?.computeMs ??
        0;

      last = {
        renderMs,
        computeMs,
        totalMs: renderMs + computeMs,
        renderQueryCount,
        computeQueryCount,
        computePasses: resolveComputePassTimings(gpu, computePasses),
      };
      return last;
    },
  };
}
