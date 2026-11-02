import type { TaskRef } from "@hello-terrain/work";
import { task } from "@hello-terrain/work";
import { WebGPURenderer } from "three/webgpu";
import { compileComputePipeline, type CompiledComputePipeline, type ComputePipeline } from "../gpu/compute";
import { innerTileSegments } from "./params";
import { leafGpuBufferTask } from "./quadtree.task";
import { textureFieldStageTask } from "./texture-field.task";
import {
  runTileBoundsReduction,
  tileBoundsContextTask,
  type TileBoundsContext,
} from "./tile-bounds.task";

/**
 * Default compile + execute tasks — uses textureFieldStageTask as the leaf.
 * Derived from the same factory as user pipelines to avoid duplicated logic.
 */
export const { compile: compileComputeTask, execute: executeComputeTask } =
  createComputePipelineTasks(textureFieldStageTask);

/**
 * Factory for user-extensible pipelines.
 *
 * Users who add custom compute stages create their own stage tasks using
 * the accumulation pattern (`get()` predecessor, spread, append), then pass
 * their leaf stage to this helper to get compile + execute tasks.
 *
 * Elevation and custom upstream stages run first. Bounds are reduced once,
 * immediately before the first callback with `needsTileBounds` (terrain-field
 * pack sets this flag). Appending non-geometric stages cannot move this boundary.
 * An elevation-only pipeline reduces bounds after its final callback.
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
export function createComputePipelineTasks(leafStageTask: TaskRef<ComputePipeline>) {
  const compile = task((get, work) => {
    const pipeline = get(leafStageTask);
    const edgeVertexCount = get(innerTileSegments) + 3;
    const boundsContext = get(tileBoundsContextTask);
    return work((previous?: CompiledComputePipeline) => {
      previous?.dispose();
      return compileComputePipeline(pipeline, edgeVertexCount, {
        preferSingleKernelWhenPossible: false,
        midPipelineExecute: (renderer, instanceCount) => {
          runTileBoundsReduction(renderer, boundsContext, instanceCount);
        },
      });
    });
  }).displayName("compileComputeTask");

  const execute = task<{ renderer: WebGPURenderer }>((get, work, { resources }) => {
    const { execute: run } = get(compile);
    const leafState = get(leafGpuBufferTask);
    return work(() => (resources?.renderer ? run(resources.renderer, leafState.count) : () => {}));
  })
    .displayName("executeComputeTask")
    .lane("gpu");

  return { compile, execute };
}

/** Bounds are reduced mid-pipeline inside {@link executeComputeTask}. */
export const tileBoundsReductionTask = task<{ renderer: WebGPURenderer }>((get, work) => {
  get(executeComputeTask);
  const boundsContext = get(tileBoundsContextTask);
  return work((): TileBoundsContext => boundsContext);
})
  .displayName("tileBoundsReductionTask")
  .lane("gpu");
