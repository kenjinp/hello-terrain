import { describe, expect, it } from "vitest";
import type { WebGPURenderer } from "three/webgpu";
import { compileComputePipeline, type ComputeStageCallback } from "./compute";

/** Observe the GPU submission boundary at which the host-side reduction runs. */
function execute(stageCount: number, boundsConsumers: number[], width: number) {
  const stages = Array.from(
    { length: stageCount },
    (_, index) =>
      Object.assign(() => {}, {
        needsTileBounds: boundsConsumers.includes(index),
      }) as ComputeStageCallback,
  );
  let submitted = 0;
  const reductions: number[] = [];
  const dispatches: number[][] = [];
  const renderer = {
    compute(_kernel: unknown, dispatch: number[]) {
      submitted++;
      dispatches.push(dispatch);
    },
  } as unknown as WebGPURenderer;
  const pipeline = compileComputePipeline(stages, width, {
    midPipelineExecute: () => reductions.push(submitted),
  });
  pipeline.execute(renderer, 3);
  return { reductions, submitted, dispatches };
}

describe("tile-bounds submission boundary", () => {
  it("keeps erosion before bounds and appended field stages after pack", () => {
    expect(execute(4, [2], 64).reductions).toEqual([2]);
  });
  it("reduces only once before the first bounds consumer", () => {
    expect(execute(5, [2, 4], 64).reductions).toEqual([2]);
  });
  it.each([1, 3])("reduces after all %i elevation-only stages", (count) => {
    expect(execute(count, [], 64).reductions).toEqual([count]);
  });
  it("does not fuse small tiles across the host reduction", () => {
    const result = execute(3, [1], 4);
    expect(result.reductions).toEqual([1]);
    expect(result.submitted).toBe(3);
    expect(result.dispatches).toEqual([
      [1, 1, 3],
      [1, 1, 3],
      [1, 1, 3],
    ]);
  });
});
