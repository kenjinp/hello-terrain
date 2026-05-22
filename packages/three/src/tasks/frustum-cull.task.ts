import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import {
  buildFinalizeIndirectKernel,
  buildFrustumCullKernel,
  buildFrustumHiZCullKernel,
} from "../gpu/frustumCull";
import {
  createRenderIndirection,
  type RenderIndirectionState,
} from "../gpu/renderIndirection";
import { createHiZContextTask } from "./hiZ-context.task";
import { tileBoundsContextTask, tileBoundsReductionTask } from "./tile-bounds.task";
import {
  frustumCulling,
  innerTileSegments,
  maxNodes,
  occlusionCulling,
} from "./params";
import { leafGpuBufferTask, leafStorageTask } from "./quadtree.task";
import {
  createCullingUniformsTask,
  createUniformsTask,
  updateUniformsTask,
  updateCullingUniformsTask,
} from "./uniforms/uniforms.task";

export interface FrustumCullContext {
  frustumKernel: ReturnType<typeof buildFrustumCullKernel>;
  hiZKernel: ReturnType<typeof buildFrustumHiZCullKernel>;
  finalizeIndirectKernel: ReturnType<typeof buildFinalizeIndirectKernel>;
}

export const createRenderIndirectionTask = task((get, work) => {
  const maxNodesValue = get(maxNodes);
  const innerTileSegmentsValue = get(innerTileSegments);

  return work((): RenderIndirectionState =>
    createRenderIndirection(maxNodesValue, innerTileSegmentsValue),
  );
}).displayName("createRenderIndirectionTask");

export const createFrustumCullContextTask = task((get, work) => {
  const leafStorage = get(leafStorageTask);
  const tileBounds = get(tileBoundsContextTask);
  const renderIndirection = get(createRenderIndirectionTask);
  const terrainUniforms = get(createUniformsTask);
  const cullingUniforms = get(createCullingUniformsTask);
  const hiZContext = get(createHiZContextTask);

  return work((): FrustumCullContext => ({
    frustumKernel: buildFrustumCullKernel(
      leafStorage.node,
      tileBounds.node,
      renderIndirection,
      terrainUniforms,
      cullingUniforms,
    ),
    hiZKernel: buildFrustumHiZCullKernel(
      leafStorage.node,
      tileBounds.node,
      renderIndirection,
      terrainUniforms,
      cullingUniforms,
      hiZContext.levels,
      hiZContext.resolution,
    ),
    finalizeIndirectKernel: buildFinalizeIndirectKernel(renderIndirection),
  }));
}).displayName("createFrustumCullContextTask");

function uploadIdentityVisibility(
  renderIndirection: RenderIndirectionState,
  leafCount: number,
): void {
  for (let i = 0; i < leafCount; i += 1) {
    renderIndirection.data[i] = i;
  }
  renderIndirection.indirectData[0] = renderIndirection.indexCount;
  renderIndirection.indirectData[1] = leafCount;
  renderIndirection.indirectData[2] = 0;
  renderIndirection.indirectData[3] = 0;
  renderIndirection.indirectData[4] = 0;
  renderIndirection.attribute.needsUpdate = true;
  renderIndirection.node.needsUpdate = true;
  renderIndirection.visibleCounterData[0] = leafCount;
  renderIndirection.visibleCounterAttribute.needsUpdate = true;
  renderIndirection.visibleCounterNode.needsUpdate = true;
  renderIndirection.indirectAttribute.needsUpdate = true;
  renderIndirection.indirectNode.needsUpdate = true;
}

function resetIndirectCount(renderIndirection: RenderIndirectionState): void {
  renderIndirection.indirectData[0] = renderIndirection.indexCount;
  renderIndirection.indirectData[1] = 0;
  renderIndirection.indirectData[2] = 0;
  renderIndirection.indirectData[3] = 0;
  renderIndirection.indirectData[4] = 0;
  renderIndirection.visibleCounterData[0] = 0;
  renderIndirection.visibleCounterAttribute.needsUpdate = true;
  renderIndirection.visibleCounterNode.needsUpdate = true;
  renderIndirection.indirectAttribute.needsUpdate = true;
  renderIndirection.indirectNode.needsUpdate = true;
}

export const frustumCullTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    get(updateUniformsTask);
    get(updateCullingUniformsTask);
    get(tileBoundsReductionTask);
    const leafState = get(leafGpuBufferTask);
    const renderIndirection = get(createRenderIndirectionTask);
    const frustumCullContext = get(createFrustumCullContextTask);
    const hiZContext = get(createHiZContextTask);
    const frustumEnabled = get(frustumCulling);
    const occlusionEnabled = get(occlusionCulling);

    return work((): RenderIndirectionState => {
      if (leafState.count <= 0) {
        uploadIdentityVisibility(renderIndirection, 0);
        return renderIndirection;
      }

      if (!resources?.renderer || (!frustumEnabled && !occlusionEnabled)) {
        uploadIdentityVisibility(renderIndirection, leafState.count);
        return renderIndirection;
      }

      resetIndirectCount(renderIndirection);

      const kernel =
        occlusionEnabled && hiZContext.ready
          ? frustumCullContext.hiZKernel
          : frustumCullContext.frustumKernel;

      resources.renderer.compute(kernel, [1, 1, leafState.count]);
      resources.renderer.compute(frustumCullContext.finalizeIndirectKernel, [
        1,
        1,
        1,
      ]);
      return renderIndirection;
    });
  },
)
  .displayName("frustumCullTask")
  .lane("gpu");
