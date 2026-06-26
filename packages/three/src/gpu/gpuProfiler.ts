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
};

/**
 * Three's renderer surface used here. `resolveTimestampsAsync` and
 * `trackTimestamp` exist on the WebGPU renderer but are not always present in
 * the published typings, so we narrow to just what we touch.
 */
type TimestampCapableRenderer = {
  trackTimestamp: boolean;
  resolveTimestampsAsync(type: "render" | "compute"): Promise<number | undefined>;
};

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

  return {
    enable(): boolean {
      // The backend clamps this to `false` during init if the device lacks the
      // `timestamp-query` feature, so reading it back reports real support.
      gpu.trackTimestamp = true;
      return gpu.trackTimestamp === true;
    },
    get enabled(): boolean {
      return gpu.trackTimestamp === true;
    },
    get last(): GpuFrameTimings | null {
      return last;
    },
    async sample(): Promise<GpuFrameTimings | null> {
      if (gpu.trackTimestamp !== true) return null;

      // Resolve serially: both share the renderer's pending-resolve guard, and
      // serial keeps the staging-buffer mapping uncontended.
      const renderMs = (await gpu.resolveTimestampsAsync("render")) ?? last?.renderMs ?? 0;
      const computeMs = (await gpu.resolveTimestampsAsync("compute")) ?? last?.computeMs ?? 0;

      last = { renderMs, computeMs, totalMs: renderMs + computeMs };
      return last;
    },
  };
}
