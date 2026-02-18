import type { TaskRef } from "@hello-terrain/work";
import { task } from "@hello-terrain/work";
import { WebGPURenderer } from "three/webgpu";
import { compileComputePipeline, type ComputePipeline } from "../gpu/compute";
import { normalFieldStageTask } from "./normal-field.task";
import { innerTileSegments } from "./params";
import { leafGpuBufferTask } from "./quadtree.task";
import { seamGpuBufferTask } from "./seam.task";

type ComputePipelineTaskOptions = {
  /**
   * Tasks that must be pulled before dispatching compute.
   * Useful for resource uploads (e.g. seam buffers) not directly referenced
   * by compute stages.
   */
  preExecuteTaskRefs?: TaskRef<unknown>[];
};

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
  options?: ComputePipelineTaskOptions,
) {
  const preExecuteTaskRefs = options?.preExecuteTaskRefs ?? [];

  const compile = task((get, work) => {
    const pipeline = get(leafStageTask);
    const edgeVertexCount = get(innerTileSegments) + 3;
    return work(() => compileComputePipeline(pipeline, edgeVertexCount, {}));
  }).displayName("compileComputeTask");

  const execute = task<{ renderer: WebGPURenderer }>(
    (get, work, { resources }) => {
      const { execute: run } = get(compile);
      const leafState = get(leafGpuBufferTask);
      for (const dep of preExecuteTaskRefs) {
        get(dep);
      }
      return work(() =>
        resources?.renderer
          ? run(resources.renderer, leafState.count)
          : () => {},
      );
    },
  )
    .displayName("executeComputeTask")
    .lane("gpu");

  return { compile, execute };
}

/** Default compile/execute tasks for the built-in terrain pipeline. */
export const { compile: compileComputeTask, execute: executeComputeTask } =
  createComputePipelineTasks(normalFieldStageTask, {
    preExecuteTaskRefs: [seamGpuBufferTask],
  });
