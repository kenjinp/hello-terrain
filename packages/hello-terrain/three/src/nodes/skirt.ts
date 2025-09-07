import { Fn, float, int, uv, vertexIndex } from "three/tsl";
import type { Node } from "three/webgpu";
import { uSegments } from "./uniforms";

/**
 * Note: Only available in the vertex shader
 *
 * Node that evaluates to true for vertices that belong to the terrain skirt.
 *
 * Determines if the current vertex lies on the outermost ring of the grid,
 * i.e. first/last column or first/last row, based on `uSegments`.
 *
 * @returns Node that resolves to a boolean indicating a skirt vertex.
 */
export const isSkirtVertex: Node = Fn(() => {
  const vIndex = int(vertexIndex);
  const segments = uSegments.toVar();
  const segmentEdges = int(segments.add(3));
  const vx = vIndex.mod(segmentEdges);
  const vy = vIndex.div(segmentEdges);
  const last = segmentEdges.sub(int(1));
  const isSkirtVertex = vx
    .equal(int(0))
    .or(vx.equal(last))
    .or(vy.equal(int(0)))
    .or(vy.equal(last));
  return isSkirtVertex;
})();

/**
 * Note: Only available in the fragment shader
 *
 * Node that evaluates to true for fragments that belong to the terrain skirt.
 *
 * Uses interpolated UVs and the grid size from `uSegments` to mark fragments
 * outside the inner range `(segmentStep, 1 - segmentStep)` on either axis as skirt.
 *
 * @returns Node that resolves to a boolean indicating a skirt fragment.
 */
export const isSkirtFragment: Node = Fn(() => {
  const ux = uv().x;
  const uy = uv().y;
  const segments = uSegments.toVar();
  const segmentCount = segments.add(2);
  const segmentStep = float(1).div(segmentCount);
  const innerX = ux
    .greaterThan(segmentStep)
    .and(ux.lessThan(segmentStep.oneMinus()));
  const innerY = uy
    .greaterThan(segmentStep)
    .and(uy.lessThan(segmentStep.oneMinus()));
  const isSkirtFragment = innerX.and(innerY).not();
  return isSkirtFragment;
})();
