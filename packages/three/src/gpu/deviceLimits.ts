import type { WebGPURenderer } from "three/webgpu";

export type ComputeDeviceLimits = {
  maxWorkgroupSizeX: number;
  maxWorkgroupSizeY: number;
  maxWorkgroupInvocations: number;
};

type RendererWithWebGPUBackend = WebGPURenderer & {
  backend?: {
    device?: {
      limits?: {
        maxComputeWorkgroupSizeX?: number;
        maxComputeWorkgroupSizeY?: number;
        maxComputeWorkgroupInvocations?: number;
      };
    };
  };
};

export function getDeviceComputeLimits(
  renderer: WebGPURenderer,
): ComputeDeviceLimits {
  const backend = (renderer as RendererWithWebGPUBackend).backend;
  const limits = backend?.device?.limits;

  return {
    maxWorkgroupSizeX: limits?.maxComputeWorkgroupSizeX ?? 256,
    maxWorkgroupSizeY: limits?.maxComputeWorkgroupSizeY ?? 256,
    maxWorkgroupInvocations: limits?.maxComputeWorkgroupInvocations ?? 256,
  };
}
