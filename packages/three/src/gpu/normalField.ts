import { Fn, cross, float, int, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

/**
 * Surface-position helpers for one leaf node, used to reconstruct a
 * curvature-correct normal from the elevation field.
 */
export type DisplacedSurfaceFns = {
  /** Displaced world position of grid sample (gx, gy) at the given height. */
  positionAt: (gx: Node, gy: Node, height: Node) => Node;
  /** Outward base direction at grid sample (gx, gy), used to orient the normal. */
  dirAt: (gx: Node, gy: Node) => Node;
};

/**
 * Build a TSL function that computes the world-space surface normal at a grid
 * point on a flat surface, by sampling the four cardinal neighbors in the
 * elevation field buffer and using central differences. The flat normal lives
 * in the XZ plane with `+Y` up, so it is already a world-space vector.
 *
 * Returns a TSL function `(nodeIndex, tileSize, ix, iy, elevationScale) => vec3`.
 */
export function createFlatNormalFromElevationField(
  elevationFieldNode: Node,
  edgeVertexCount: number,
) {
  return Fn(
    ([nodeIndex, tileSize, ix, iy, elevationScale]: [Node, Node, Node, Node, Node]) => {
      const iEdge = int(edgeVertexCount);
      const verticesPerNode = iEdge.mul(iEdge);
      const baseOffset = int(nodeIndex).mul(verticesPerNode);

      const xLeft = int(ix).sub(int(1));
      const xRight = int(ix).add(int(1));
      const yUp = int(iy).sub(int(1));
      const yDown = int(iy).add(int(1));

      const hLeft = elevationFieldNode
        .element(baseOffset.add(int(iy).mul(iEdge).add(xLeft)))
        .mul(elevationScale);
      const hRight = elevationFieldNode
        .element(baseOffset.add(int(iy).mul(iEdge).add(xRight)))
        .mul(elevationScale);
      const hUp = elevationFieldNode
        .element(baseOffset.add(yUp.mul(iEdge).add(int(ix))))
        .mul(elevationScale);
      const hDown = elevationFieldNode
        .element(baseOffset.add(yDown.mul(iEdge).add(int(ix))))
        .mul(elevationScale);

      const innerSegments = float(iEdge).sub(float(3));
      const stepWorld = tileSize.div(innerSegments);
      const inv2Step = float(0.5).div(stepWorld);
      const dhdx = float(hRight).sub(float(hLeft)).mul(inv2Step);
      const dhdz = float(hDown).sub(float(hUp)).mul(inv2Step);

      return vec3(dhdx.negate(), float(1), dhdz.negate()).normalize();
    },
  );
}

/**
 * Build a TSL function that computes the world-space surface normal at a grid
 * point on a curved, closed surface (sphere or torus).
 *
 * Rather than differencing heights in face-local `(u, v)` space (which ignores
 * the non-uniform surface metric and decomposes the result in a per-tile
 * tangent frame — the source of seam discontinuities), this reconstructs the
 * displaced world positions of the four cardinal neighbors and takes the cross
 * product of the spanning tangents. The result is metric- and curvature-correct
 * and frame-independent, so neighboring tiles converge to the same normal at a
 * shared edge.
 *
 * `makeSurfaceFns(nodeIndex)` supplies the projection-specific displaced
 * position and outward direction for the current leaf node.
 *
 * Returns a TSL function `(nodeIndex, ix, iy, elevationScale) => vec3`.
 */
export function createDisplacedSurfaceNormalFromElevationField(
  elevationFieldNode: Node,
  edgeVertexCount: number,
  makeSurfaceFns: (nodeIndex: Node) => DisplacedSurfaceFns,
) {
  return Fn(([nodeIndex, ix, iy, elevationScale]: [Node, Node, Node, Node]) => {
    const iEdge = int(edgeVertexCount);
    const verticesPerNode = iEdge.mul(iEdge);
    const baseOffset = int(nodeIndex).mul(verticesPerNode);

    const xLeft = int(ix).sub(int(1));
    const xRight = int(ix).add(int(1));
    const yUp = int(iy).sub(int(1));
    const yDown = int(iy).add(int(1));

    const heightAt = (gx: Node, gy: Node) =>
      elevationFieldNode.element(baseOffset.add(gy.mul(iEdge).add(gx))).mul(elevationScale);

    const { positionAt, dirAt } = makeSurfaceFns(nodeIndex);

    const pLeft = positionAt(xLeft, int(iy), heightAt(xLeft, int(iy)));
    const pRight = positionAt(xRight, int(iy), heightAt(xRight, int(iy)));
    const pUp = positionAt(int(ix), yUp, heightAt(int(ix), yUp));
    const pDown = positionAt(int(ix), yDown, heightAt(int(ix), yDown));

    const tangentU = pRight.sub(pLeft);
    const tangentV = pDown.sub(pUp);
    const normal = cross(tangentU, tangentV).normalize();

    // Orient outward.
    const dir = dirAt(int(ix), int(iy));
    return normal.mul(normal.dot(dir).sign());
  });
}
