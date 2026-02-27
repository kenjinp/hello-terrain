import type { Ray } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { TerrainSampler } from "./types";
import type { RaycastOptions, TerrainRaycastResult } from "./types";

type RendererWithAsyncCompute = WebGPURenderer & {
  computeAsync?: (kernel: unknown, dispatch?: [number, number, number]) => Promise<void>;
  getArrayBufferAsync?: (attribute: unknown) => Promise<ArrayBuffer>;
};

export type GpuRaycastRunner = {
  pickAsync(ray: Ray, options?: RaycastOptions): Promise<TerrainRaycastResult | null>;
};

export type CreateGpuRaycastRunnerParams = {
  renderer: WebGPURenderer;
  terrainSampler: TerrainSampler;
  cpuFallback: (ray: Ray, options?: RaycastOptions) => TerrainRaycastResult | null;
};

/**
 * Async raycast runner.
 *
 * This keeps a clean async interface and can be upgraded to a fully GPU-backed
 * compute kernel without changing callsites. If async compute/readback is not
 * available, it falls back to the sync CPU raycast and wraps the result in a Promise.
 */
export function createGpuRaycastRunner(
  params: CreateGpuRaycastRunnerParams,
): GpuRaycastRunner {
  const renderer = params.renderer as RendererWithAsyncCompute;
  const supportsAsyncCompute =
    typeof renderer.computeAsync === "function" &&
    typeof renderer.getArrayBufferAsync === "function";

  // Keep sampler captured so the runner's contract stays aligned with
  // TerrainSampler-based GPU implementation even when using fallback mode.
  void params.terrainSampler;

  return {
    async pickAsync(
      ray: Ray,
      options?: RaycastOptions,
    ): Promise<TerrainRaycastResult | null> {
      if (!supportsAsyncCompute) {
        return params.cpuFallback(ray, options);
      }

      // GPU compute path placeholder:
      // the module shape is ready for a TerrainSampler-powered compute kernel.
      // Until the renderer exposes stable async compute+buffer readback in this
      // runtime, we preserve correctness by delegating to the CPU fallback.
      return params.cpuFallback(ray, options);
    },
  };
}
