import { Fn, If, float, globalId, int, uint, uniform, vec2, workgroupBarrier } from "three/tsl";
import type { Node, WebGPURenderer } from "three/webgpu";

// ── Types ────────────────────────────────────────────────────────────────

export type ComputeStageCallback = (
  nodeIndex: Node,
  globalVertexIndex: Node,
  uv: Node,
  localCoordinates: Node,
  texelSize: Node,
) => void;

/** An ordered list of compute stage callbacks forming a fused pipeline. */
export type ComputePipeline = ComputeStageCallback[];

// ── Constants ────────────────────────────────────────────────────────────

const WORKGROUP_X = 16;
const WORKGROUP_Y = 16;

// ── Pipeline compiler ────────────────────────────────────────────────────

/**
 * Compiles an ordered list of compute stage callbacks into a single fused
 * GPU kernel. Each stage is invoked sequentially with a `workgroupBarrier()`
 * between consecutive stages so that earlier writes are visible to later reads.
 *
 * The kernel uses 2D workgroups (X/Y iterate over a tile's vertex grid) and
 * the Z-axis iterates over active leaf nodes.
 *
 * The instance count (number of active leaves) is passed at dispatch time
 * via a uniform — not baked into the shader — so the kernel is compiled once
 * and reused regardless of how often the quadtree changes.
 *
 * @param stages    Ordered array of per-vertex callbacks.
 * @param width     Edge vertex count (tile grid is width × width).
 * @param bindings  Optional TSL nodes to force-bind (safety net for
 *                  `.setLayout()` edge cases).
 */
export function compileComputePipeline(
  stages: ComputePipeline,
  width: number,
  bindings?: Node[],
): { execute: (renderer: WebGPURenderer, instanceCount: number) => void } {
  const workgroupSize: [number, number, number] = [WORKGROUP_X, WORKGROUP_Y, 1];
  const dispatchX = Math.ceil(width / WORKGROUP_X);
  const dispatchY = Math.ceil(width / WORKGROUP_Y);

  // Uniform so that changing the leaf count doesn't trigger shader recompilation
  const uInstanceCount = uniform(0, "uint");

  const computeShader = Fn(() => {
    // Force-bind any external resources that TSL can't auto-discover
    bindings?.forEach((b) => b.toVar());

    const fWidth = float(width);
    const activeIndex = globalId.z;
    // Leaves are packed contiguously at indices 0..count-1,
    // so activeIndex IS the nodeIndex.
    const nodeIndex = int(activeIndex).toVar();
    const iWidth = int(width);
    const ix = int(globalId.x);
    const iy = int(globalId.y);

    // Compute shared per-thread values unconditionally (safe — just arithmetic)
    const texelSize = vec2(1, 1).div(fWidth);
    const localCoordinates = vec2(globalId.x, globalId.y);
    const localUVCoords = localCoordinates.div(fWidth);
    const verticesPerNode = iWidth.mul(iWidth);
    const globalIndex = int(nodeIndex).mul(verticesPerNode).add(iy.mul(iWidth).add(ix));

    // Bounds check — stored as a variable so each If reuses it.
    // uInstanceCount is a uniform, so this adapts at dispatch time
    // without recompiling the shader.
    const inBounds = ix
      .lessThan(iWidth)
      .and(iy.lessThan(iWidth))
      .and(uint(activeIndex).lessThan(uInstanceCount))
      .toVar();

    // Each stage gets its own If block; barriers sit at the top level
    // where all threads reach them (uniform control flow).
    for (let i = 0; i < stages.length; i++) {
      if (i > 0) {
        workgroupBarrier();
      }
      If(inBounds, () => {
        stages[i](nodeIndex, globalIndex, localUVCoords, localCoordinates, texelSize);
      });
    }
  })().computeKernel(workgroupSize);

  function execute(renderer: WebGPURenderer, instanceCount: number) {
    uInstanceCount.value = instanceCount;
    renderer.compute(computeShader, [dispatchX, dispatchY, instanceCount]);
  }

  return { execute };
}
