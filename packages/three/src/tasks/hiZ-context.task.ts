import { task } from "@hello-terrain/work";
import {
  buildHiZCopyKernel,
  buildHiZMipKernel,
  createHiZCaptureTarget,
  createHiZTextureLevels,
  type HiZTextureLevel,
} from "../gpu/hiZ";
import { hiZResolution } from "./params";

export interface HiZContext {
  captureTarget: ReturnType<typeof createHiZCaptureTarget>;
  levels: readonly HiZTextureLevel[];
  copyKernel: ReturnType<typeof buildHiZCopyKernel>;
  mipKernels: readonly ReturnType<typeof buildHiZMipKernel>[];
  ready: boolean;
  resolution: number;
}

export const createHiZContextTask = task((get, work) => {
  const resolution = Math.max(1, get(hiZResolution));

  return work((): HiZContext => {
    const captureTarget = createHiZCaptureTarget(resolution, resolution);
    const levels = createHiZTextureLevels(resolution);
    const copyKernel = buildHiZCopyKernel(captureTarget.texture, levels[0]!);
    const mipKernels = levels
      .slice(1)
      .map((destination, index) =>
        buildHiZMipKernel(levels[index]!, destination),
      );

    return {
      captureTarget,
      levels,
      copyKernel,
      mipKernels,
      ready: false,
      resolution,
    };
  });
}).displayName("createHiZContextTask");
