import type { TaskRef } from "@hello-terrain/work";
import { task } from "@hello-terrain/work";
import { WebGPURenderer } from "three/webgpu";
import { compileComputePipeline, type ComputePipeline } from "../gpu/compute";
import { terrainFieldStageTask } from "./terrain-field.task";
import { innerTileSegments } from "./params";
import {
  dirtyVisibleSlotBufferTask,
  dirtyVisibleSlotStorageTask,
  leafGpuBufferTask,
} from "./quadtree.task";

/**
 * Default compile + execute tasks — uses terrainFieldStageTask as the leaf.
 * Derived from the same factory as user pipelines to avoid duplicated logic.
 */
export const { compile: compileComputeTask, execute: executeComputeTask } =
  createComputePipelineTasks(terrainFieldStageTask);

/**
 * Factory for user-extensible pipelines.
 *
 * Users who add custom compute stages create their own stage tasks using
 * the accumulation pattern (`get()` predecessor, spread, append), then pass
 * their leaf stage to this helper to get compile + execute tasks.
 *
 * @example
 * ```ts
 * const erosionStageTask = task((get, work) => {
 *   const upstream = get(elevationFieldStageTask);
 *   return work((): ComputePipeline => [
 *     ...upstream,
 *     (nodeIndex, globalVertexIndex, uv) => {
 *       // custom erosion logic
 *     },
 *   ]);
 * });
 *
 * const { compile, execute } = createComputePipelineTasks(erosionStageTask);
 * ```
 */
export function createComputePipelineTasks(
  leafStageTask: TaskRef<ComputePipeline>,
  label = "terrainField",
) {
  const compile = task((get, work) => {
    const pipeline = get(leafStageTask);
    const edgeVertexCount = get(innerTileSegments) + 3;
    const dirtyVisibleSlotStorage = get(dirtyVisibleSlotStorageTask);
    return work(() =>
      compileComputePipeline(pipeline, edgeVertexCount, {
        preferSingleKernelWhenPossible: false,
        instanceSource: "dirty-visible-slot",
        dirtyVisibleSlotStorage,
        label,
      }),
    );
  }).displayName("compileComputeTask");

  const execute = task<{ renderer: WebGPURenderer }>(
    (get, work, ctx) => {
      const { execute: run } = get(compile);
      get(leafGpuBufferTask);
      const dirtyVisibleSlots = get(dirtyVisibleSlotBufferTask);
      return work(() => {
        if (ctx.signal.aborted) {
          throw ctx.signal.reason ?? new Error("Terrain compute aborted");
        }
        return ctx.resources?.renderer && dirtyVisibleSlots.count > 0
          ? run(ctx.resources.renderer, dirtyVisibleSlots.count)
          : () => {};
      });
    },
  )
    .displayName("executeComputeTask")
    .lane("gpu");

  return { compile, execute };
}
