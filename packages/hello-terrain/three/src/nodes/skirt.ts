import {
  Fn,
  type ShaderNodeObject,
  float,
  int,
  uv,
  vertexIndex,
} from "three/tsl";
import type { ConstNode, Vector2 } from "three/webgpu";
import { uSegments } from "./uniforms";

/**
 * Returns a node that is true for skirt vertices in the vertex stage.
 *
 * @remarks
 * Only valid in the vertex shader. A vertex belongs to the skirt if it is on
 * the outermost ring of the tile grid (first/last column or row). The grid
 * resolution is derived from `uSegments`.
 *
 * @returns A node resolving to a boolean indicating a skirt vertex.
 */
export const isSkirtVertex = /*@__PURE__*/ Fn(() => {
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
});

/**
 * Returns a node that is true for skirt fragments in the fragment stage.
 *
 * @remarks
 * Only valid in the fragment shader. Uses interpolated UVs and the grid size
 * from `uSegments` to mark fragments outside the inner range
 * `(step, 1 - step)` on either axis as skirt, where `step = 1 / (uSegments + 2)`.
 *
 * @returns A node resolving to a boolean indicating a skirt fragment.
 */
export const isSkirtFragment = /*@__PURE__*/ Fn(() => {
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
}).setLayout({
  name: "isSkirtFragment",
  type: "bool",
  inputs: [],
});

/**
 * Returns a node that is true for skirt vertices in the compute shader.
 *
 * @remarks
 * Only valid in the compute shader. Uses interpolated UVs and the grid size
 * from `uSegments` to mark fragments outside the inner range
 * `(step, 1 - step)` on either axis as skirt, where `step = 1 / (uSegments + 2)`.
 *
 * @returns A node resolving to a boolean indicating a skirt fragment.
 */
export const isSkirtCompute = /*@__PURE__*/ Fn(
  ([localUV]: [ShaderNodeObject<ConstNode<Vector2>>]) => {
    const ux = localUV.x;
    const uy = localUV.y;
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
  }
).setLayout({
  name: "isSkirtFragment",
  type: "bool",
  inputs: [
    {
      name: "localUV",
      type: "vec2",
      qualifier: "in",
    },
  ],
});
