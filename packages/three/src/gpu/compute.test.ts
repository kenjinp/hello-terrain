import { expect, it, vi } from "vitest";
import { Fn } from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import { compileComputePipeline } from "./compute";

function fixture(maxInvocations = 256) {
  const compute = vi.fn();
  const renderer = {
    compute,
    backend: { device: { limits: {
      maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupInvocations: maxInvocations,
    } } },
  } as unknown as WebGPURenderer;
  const bounds = Fn(() => {})().computeKernel([64, 1, 1]);
  const dispatchSize = (count: number): [number, number, number] => [1, 1, count];
  return { compute, renderer, bounds, midPipelineCompute: { kernel: bounds, dispatchSize } };
}

it("batches elevation, bounds and pack with independent dispatch sizes at default resolution", () => {
  const f = fixture();
  const pipeline = compileComputePipeline([() => {}, () => {}], 64, { midPipelineCompute: f.midPipelineCompute });
  pipeline.execute(f.renderer, 67);
  expect(f.compute).toHaveBeenCalledTimes(1);
  expect(f.compute.mock.calls[0]).toHaveLength(1);
  const nodes = f.compute.mock.calls[0][0];
  expect(nodes).toHaveLength(3);
  expect(nodes[1]).toBe(f.bounds);
  expect(nodes.map((node: any) => node.count)).toEqual([[4, 4, 67], [1, 1, 67], [4, 4, 67]]);
  pipeline.dispose(); f.bounds.dispose();
});

it("retains the group and kernels while updating counts and keeps small tiles staged", () => {
  const f = fixture();
  const pipeline = compileComputePipeline([() => {}, () => {}], 16, { midPipelineCompute: f.midPipelineCompute });
  pipeline.execute(f.renderer, 1);
  const nodes = f.compute.mock.calls[0][0];
  expect(nodes).toHaveLength(3);
  pipeline.execute(f.renderer, 7);
  expect(f.compute.mock.calls[1][0]).toBe(nodes);
  expect(nodes.map((node: any) => node.count)).toEqual([[1, 1, 7], [1, 1, 7], [1, 1, 7]]);
  pipeline.dispose(); f.bounds.dispose();
});

it("honors device limits and keeps custom upstream stages before bounds", () => {
  const f = fixture(64);
  const pipeline = compileComputePipeline([() => {}, () => {}, () => {}], 35, { midPipelineCompute: f.midPipelineCompute });
  pipeline.execute(f.renderer, 3);
  const nodes = f.compute.mock.calls[0][0];
  expect(nodes).toHaveLength(4);
  expect(nodes[2]).toBe(f.bounds);
  expect(nodes.map((node: any) => node.count)).toEqual([[3, 9, 3], [3, 9, 3], [1, 1, 3], [3, 9, 3]]);
  pipeline.dispose(); f.bounds.dispose();
});

it("preserves generic callback execution between separate upstream and final submissions", () => {
  const f = fixture();
  const callback = vi.fn(() => { expect(f.compute).toHaveBeenCalledTimes(2); });
  const pipeline = compileComputePipeline([() => {}, () => {}, () => {}], 64, {
    preferSingleKernelWhenPossible: false, midPipelineExecute: callback,
    midPipelineCompute: f.midPipelineCompute,
  });
  pipeline.execute(f.renderer, 2);
  expect(callback).toHaveBeenCalledExactlyOnceWith(f.renderer, 2);
  expect(f.compute).toHaveBeenCalledTimes(3);
  expect(f.compute.mock.calls.every(call => !Array.isArray(call[0]))).toBe(true);
  pipeline.dispose(); f.bounds.dispose();
});

it("does not dispatch an empty batched terrain or insert bounds into a single-stage pipeline", () => {
  const f = fixture();
  const pipeline = compileComputePipeline([() => {}, () => {}], 64, { midPipelineCompute: f.midPipelineCompute });
  pipeline.execute(f.renderer, 0);
  expect(f.compute).not.toHaveBeenCalled();
  pipeline.dispose();
  const single = compileComputePipeline([() => {}], 64, { midPipelineCompute: f.midPipelineCompute });
  single.execute(f.renderer, 2);
  expect(f.compute).toHaveBeenCalledTimes(1);
  expect(Array.isArray(f.compute.mock.calls[0][0])).toBe(false);
  single.dispose(); f.bounds.dispose();
});

it("disposes owned kernels but leaves the intermediate kernel with its owning context", () => {
  const f = fixture();
  const boundsDispose = vi.spyOn(f.bounds, "dispose");
  const pipeline = compileComputePipeline([() => {}, () => {}], 64, { midPipelineCompute: f.midPipelineCompute });
  pipeline.execute(f.renderer, 1);
  const nodes = f.compute.mock.calls[0][0];
  const firstDispose = vi.spyOn(nodes[0], "dispose"), lastDispose = vi.spyOn(nodes[2], "dispose");
  pipeline.dispose();
  expect(firstDispose).toHaveBeenCalledTimes(1);
  expect(lastDispose).toHaveBeenCalledTimes(1);
  expect(boundsDispose).not.toHaveBeenCalled();
  pipeline.execute(f.renderer, 2);
  expect(f.compute.mock.calls[1][0]).not.toBe(nodes);
  pipeline.dispose(); f.bounds.dispose();
});
