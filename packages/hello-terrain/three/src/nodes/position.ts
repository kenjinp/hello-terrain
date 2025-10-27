import {
  Fn,
  instanceIndex,
  int,
  positionLocal,
  select,
  vec3,
  vertexIndex,
} from "three/tsl";
import { readNormalAtPositionLocal } from "./normals";
import { heightmapStorageProperty, nodeStorageProperty } from "./properties";
import { isSkirtVertex } from "./skirt";
import { tileGeometryPosition, tileIsLeaf } from "./tile";
import { uHeightmapScale, uSegments } from "./uniforms";
import { vElevation, vGlobalVertexIndex, vNormal } from "./varyings";

export const worldPosition = /*@__PURE__*/ Fn(() => {
  const nodeIndex = int(instanceIndex);
  const worldPosition = tileGeometryPosition(nodeIndex, positionLocal);
  const isLeaf = tileIsLeaf(nodeIndex);

  // Force a zero-effect dependency on nodeStorageProperty so the renderer
  // declares and binds the read-only storage buffer for the vertex stage.
  const _forceBind = nodeStorageProperty.element(int(0)).toFloat().mul(0);

  // Compute and pass global vertex index to fragment stage
  const edgeVertexCount = uSegments.toVar().add(3);
  const intEdgeVertexCount = int(edgeVertexCount);
  const verticesPerNode = intEdgeVertexCount.mul(intEdgeVertexCount);
  const globalIndex = nodeIndex.mul(verticesPerNode).add(int(vertexIndex));
  vGlobalVertexIndex.assign(globalIndex);

  const height = heightmapStorageProperty
    .element(vGlobalVertexIndex)
    .mul(uHeightmapScale.toVar());
  vElevation.assign(height);

  const vx = int(vertexIndex).mod(intEdgeVertexCount);
  const vy = int(vertexIndex).div(intEdgeVertexCount);
  const last = intEdgeVertexCount.sub(int(1));
  const adjX = vx
    .equal(int(0))
    .select(int(1), vx.equal(last).select(last.sub(int(1)), vx));
  const adjY = vy
    .equal(int(0))
    .select(int(1), vy.equal(last).select(last.sub(int(1)), vy));
  const perNodeAdjIndex = adjY.mul(intEdgeVertexCount).add(adjX);
  const globalAdjIndex = nodeIndex.mul(verticesPerNode).add(perNodeAdjIndex);
  const skirtEdgeHeight = heightmapStorageProperty
    .element(globalAdjIndex)
    .mul(uHeightmapScale.toVar());

  const beforeTransform = select(
    isSkirtVertex(),
    vec3(
      worldPosition.x,
      worldPosition.y.add(skirtEdgeHeight).add(_forceBind),
      worldPosition.z
    ),
    vec3(
      worldPosition.x,
      worldPosition.y.add(height).add(_forceBind),
      worldPosition.z
    )
  );

  vNormal.assign(readNormalAtPositionLocal());

  return select(isLeaf, beforeTransform, vec3(0, 0, 0));
});
