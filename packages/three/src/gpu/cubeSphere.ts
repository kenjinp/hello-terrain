import {
  Fn,
  float,
  instanceIndex,
  int,
  positionLocal,
  pow,
  select,
  vec2,
  vec3,
} from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import { isSkirtVertex } from "../tsl/skirt";
import { createTileElevation, createNormalAssignment } from "./worldPosition";

/**
 * Maps face index + (s, t) in [-1, 1] to a 3D cube coordinate using TSL.
 *
 * Uses the same face UV convention as the CPU-side `faceToCube`.
 */
function faceToCubeTSL(space: Node, s: Node, t: Node) {
  const cubeX = select(
    space.equal(0),
    float(1),
    select(
      space.equal(1),
      float(-1),
      select(space.equal(2), s, select(space.equal(3), s, select(space.equal(4), s, s.negate()))),
    ),
  );
  const cubeY = select(
    space.equal(0),
    t.negate(),
    select(
      space.equal(1),
      t.negate(),
      select(
        space.equal(2),
        float(1),
        select(space.equal(3), float(-1), select(space.equal(4), t.negate(), t.negate())),
      ),
    ),
  );
  const cubeZ = select(
    space.equal(0),
    s.negate(),
    select(
      space.equal(1),
      s,
      select(
        space.equal(2),
        t,
        select(space.equal(3), t.negate(), select(space.equal(4), float(1), float(-1))),
      ),
    ),
  );
  return vec3(cubeX, cubeY, cubeZ);
}

/**
 * Creates tile compute functions for a cube sphere surface.
 *
 * Reads (level, x, y, space) from the leaf storage buffer and projects
 * tile vertex positions onto a sphere. The `uRootSize` uniform is
 * interpreted as the sphere radius.
 */
export function createCubeSphereTileCompute(
  leafStorage: LeafStorageState,
  uniforms: TerrainUniformsContext,
) {
  const tileLevel = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    return leafStorage.node.element(nodeOffset).toInt();
  });

  const tileOriginVec2 = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();
    return vec2(nodeX, nodeY);
  });

  const tileSpace = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    return leafStorage.node.element(nodeOffset.add(int(3))).toInt();
  });

  const tileSize = Fn(([nodeIndex]: [Node]) => {
    const radius = uniforms.uRootSize.toVar();
    const level = tileLevel(nodeIndex);
    return float(radius).mul(float(Math.PI * 0.5)).div(pow(float(2), level.toFloat()));
  });

  const rootUVCompute = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const level = tileLevel(nodeIndex);
    const tilesPerEdge = pow(float(2), level.toFloat());

    const faceU = nodeVec2.x
      .add(int(ix).toFloat().sub(float(1)).div(fInnerSegments))
      .div(tilesPerEdge);
    const faceV = nodeVec2.y
      .add(int(iy).toFloat().sub(float(1)).div(fInnerSegments))
      .div(tilesPerEdge);

    return vec2(faceU, faceV);
  });

  const tileVertexWorldPositionCompute = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    const radius = uniforms.uRootSize.toVar().toFloat();
    const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const space = tileSpace(nodeIndex);
    const level = tileLevel(nodeIndex);
    const tilesPerEdge = pow(float(2), level.toFloat());

    const faceU = nodeVec2.x
      .add(int(ix).toFloat().sub(float(1)).div(fInnerSegments))
      .div(tilesPerEdge);
    const faceV = nodeVec2.y
      .add(int(iy).toFloat().sub(float(1)).div(fInnerSegments))
      .div(tilesPerEdge);

    const s = faceU.mul(float(2)).sub(float(1));
    const t = faceV.mul(float(2)).sub(float(1));
    const cubePoint = faceToCubeTSL(space, s, t);
    const spherePoint = cubePoint.normalize().mul(radius);
    const rootOrigin = uniforms.uRootOrigin.toVar();
    return vec3(spherePoint.x.add(rootOrigin.x), spherePoint.y.add(rootOrigin.y), spherePoint.z.add(rootOrigin.z));
  });

  return {
    tileLevel,
    tileOriginVec2,
    tileSpace,
    tileSize,
    rootUVCompute,
    tileVertexWorldPositionCompute,
  };
}

/**
 * Render-side base world position for cube sphere.
 *
 * Reads tile data from the leaf storage buffer, maps the vertex
 * (via `positionLocal`) onto the sphere surface, and returns the
 * 3D sphere position offset by `uRootOrigin`.
 */
export function createCubeSphereTileBaseWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
) {
  return Fn(() => {
    const nodeIndex = int(instanceIndex);
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeLevel = leafStorage.node.element(nodeOffset).toInt();
    const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();
    const nodeSpace = leafStorage.node.element(nodeOffset.add(int(3))).toInt();

    const radius = terrainUniforms.uRootSize.toVar().toFloat();
    const rootOrigin = terrainUniforms.uRootOrigin.toVar();
    const tilesPerEdge = pow(float(2), nodeLevel.toFloat());

    const clampedX = positionLocal.x.max(float(-0.5)).min(float(0.5));
    const clampedZ = positionLocal.z.max(float(-0.5)).min(float(0.5));

    const faceU = nodeX.add(clampedX).add(float(0.5)).div(tilesPerEdge);
    const faceV = nodeY.add(clampedZ).add(float(0.5)).div(tilesPerEdge);

    const s = faceU.mul(float(2)).sub(float(1));
    const t = faceV.mul(float(2)).sub(float(1));
    const cubePoint = faceToCubeTSL(nodeSpace, s, t);
    const spherePoint = cubePoint.normalize().mul(radius);

    return vec3(
      spherePoint.x.add(rootOrigin.x),
      spherePoint.y.add(rootOrigin.y),
      spherePoint.z.add(rootOrigin.z),
    );
  });
}

/**
 * Builds the full render-side position node for a cube sphere terrain.
 *
 * Computes the sphere surface base position, reads the per-vertex
 * elevation from the elevation field buffer, and displaces along the
 * radial direction. Skirt vertices are pulled inward toward the sphere
 * center instead of downward.
 */
export function createCubeSphereWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  elevationFieldBufferNode?: StorageBufferNode,
  normalFieldBufferNode?: Node,
) {
  const baseWorldPosition = createCubeSphereTileBaseWorldPosition(leafStorage, terrainUniforms);

  return Fn(() => {
    const base = baseWorldPosition();
    const rootOrigin = terrainUniforms.uRootOrigin.toVar();
    const relativeBase = vec3(
      base.x.sub(rootOrigin.x),
      base.y.sub(rootOrigin.y),
      base.z.sub(rootOrigin.z),
    );
    const radialDir = relativeBase.normalize();

    const elevation = createTileElevation(terrainUniforms, elevationFieldBufferNode);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const elevatedPos = base.add(radialDir.mul(elevation));
    const skirtPos = elevatedPos.sub(radialDir.mul(terrainUniforms.uSkirtScale.toVar()));

    createNormalAssignment(terrainUniforms, normalFieldBufferNode);

    const finalX = select(skirtVertex, skirtPos.x, elevatedPos.x);
    const finalY = select(skirtVertex, skirtPos.y, elevatedPos.y);
    const finalZ = select(skirtVertex, skirtPos.z, elevatedPos.z);
    return vec3(finalX, finalY, finalZ);
  })();
}

export const cubeSphereProjection = {
  createTileCompute: createCubeSphereTileCompute,
  createWorldPosition: createCubeSphereWorldPosition,
};
