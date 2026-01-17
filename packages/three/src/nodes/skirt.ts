import { Fn, float, int, uv, vertexIndex } from "three/tsl";
import type { ConstNode, Node } from "three/webgpu";

/**
 * Input type for segment count: either a JS number or a TSL integer node.
 * When a number is provided, it's automatically converted to an int node.
 * When a Node is provided, it should resolve to an integer value.
 */
export type IntNodeInput = number | ConstNode<number> | Node;

/**
 * Returns a node that is true for skirt vertices in the vertex stage.
 *
 * @remarks
 * Only valid in the vertex shader. A vertex belongs to the skirt if it is on
 * the outermost ring of the tile grid (first/last column or row). The grid
 * resolution is derived from `segments`.
 *
 * @param segments - The number of inner segments in the terrain grid.
 * @returns A node resolving to a boolean indicating a skirt vertex.
 */
export const isSkirtVertex = Fn<[segments: IntNodeInput]>(([segments]) => {
  const segmentsNode = typeof segments === "number" ? int(segments) : segments;
  const vIndex = int(vertexIndex);
  const segmentEdges = int(segmentsNode.add(3));
  const vx = vIndex.mod(segmentEdges);
  const vy = vIndex.div(segmentEdges);
  const last = segmentEdges.sub(int(1));
  return vx
    .equal(int(0))
    .or(vx.equal(last))
    .or(vy.equal(int(0)))
    .or(vy.equal(last));
});

/**
 * Returns a node that is true for skirt UVs.
 *
 * @remarks
 * Uses interpolated UVs and the grid size
 * from `segments` to mark fragments outside the inner range
 * `(step, 1 - step)` on either axis as skirt, where `step = 1 / (segments + 2)`.
 *
 * @param segments - The number of inner segments in the terrain grid.
 * @returns A node resolving to a boolean indicating a skirt fragment.
 */
export const isSkirtUV = Fn<[segments: IntNodeInput]>(([segments]) => {
  const segmentsNode = typeof segments === "number" ? int(segments) : segments;
  const ux = uv().x;
  const uy = uv().y;
  const segmentCount = segmentsNode.add(2);
  const segmentStep = float(1).div(segmentCount);
  const innerX = ux
    .greaterThan(segmentStep)
    .and(ux.lessThan(segmentStep.oneMinus()));
  const innerY = uy
    .greaterThan(segmentStep)
    .and(uy.lessThan(segmentStep.oneMinus()));
  return innerX.and(innerY).not();
});
