import { task } from "@hello-terrain/work";
import type { RenderTarget, WebGPURenderer } from "three/webgpu";
import { frustumCullTask } from "./frustum-cull.task";
import { createHiZContextTask } from "./hiZ-context.task";
import { occlusionCulling } from "./params";

export { createHiZContextTask } from "./hiZ-context.task";
export type { HiZContext } from "./hiZ-context.task";

export type CaptureTerrainDepth = (target: RenderTarget) => void;

function dispatchSize(size: number) {
  return Math.max(1, Math.ceil(size / 8));
}

export const captureDepthTask = task<{
  renderer: WebGPURenderer;
  captureTerrainDepth?: CaptureTerrainDepth;
}>((get, work, { resources }) => {
  get(frustumCullTask);
  const hiZContext = get(createHiZContextTask);
  const occlusionEnabled = get(occlusionCulling);

  return work(() => {
    if (occlusionEnabled) {
      resources?.captureTerrainDepth?.(hiZContext.captureTarget);
    }
    return hiZContext;
  });
})
  .displayName("captureDepthTask")
  .lane("gpu");

export const updateHiZTask = task<{
  renderer: WebGPURenderer;
  captureTerrainDepth?: CaptureTerrainDepth;
}>((get, work, { resources }) => {
  get(captureDepthTask);
  const hiZContext = get(createHiZContextTask);
  const occlusionEnabled = get(occlusionCulling);

  return work(() => {
    if (!occlusionEnabled || !resources?.renderer) {
      return hiZContext;
    }

    resources.renderer.compute(hiZContext.copyKernel, [
      dispatchSize(hiZContext.levels[0]?.width ?? 1),
      dispatchSize(hiZContext.levels[0]?.height ?? 1),
      1,
    ]);

    for (let i = 0; i < hiZContext.mipKernels.length; i += 1) {
      const level = hiZContext.levels[i + 1]!;
      resources.renderer.compute(hiZContext.mipKernels[i]!, [
        dispatchSize(level.width),
        dispatchSize(level.height),
        1,
      ]);
    }

    hiZContext.ready = true;
    return hiZContext;
  });
})
  .displayName("updateHiZTask")
  .lane("gpu");
