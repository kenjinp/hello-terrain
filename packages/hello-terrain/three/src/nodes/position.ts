import {
  Fn,
  instanceIndex,
  int,
  positionLocal,
  select,
  vec3,
  vertexIndex,
} from "three/tsl";
import { heightmapStorageProperty, nodeStorageProperty } from "./properties";
import { isSkirtVertex } from "./skirt";
import { tileGeometryPosition, tileIsLeaf } from "./tile";
import { uHeightmapScale, uSegments } from "./uniforms";
import { vElevation, vGlobalVertexIndex } from "./varyings";

export const worldPosition = /*@__PURE__*/ Fn(() => {
  const nodeIndex = instanceIndex;
  const worldPosition = tileGeometryPosition(nodeIndex, positionLocal);
  const isLeaf = tileIsLeaf(nodeIndex);

  // Force a zero-effect dependency on nodeStorageProperty so the renderer
  // declares and binds the read-only storage buffer for the vertex stage.
  const _forceBind = nodeStorageProperty.element(int(0)).toFloat().mul(0);

  // Compute and pass global vertex index to fragment stage
  const edgeVertexCount = uSegments.toVar().add(3);
  const intEdgeVertexCount = int(edgeVertexCount);
  const verticesPerNode = intEdgeVertexCount.mul(intEdgeVertexCount);
  const globalIndex = nodeIndex.mul(verticesPerNode).add(vertexIndex);
  vGlobalVertexIndex.assign(globalIndex);

  const height = heightmapStorageProperty
    .toVar()
    .element(vGlobalVertexIndex)
    .mul(uHeightmapScale.toVar());
  vElevation.assign(height);

  const beforeTransform = select(
    isSkirtVertex(),
    vec3(worldPosition.x, worldPosition.y.add(_forceBind), worldPosition.z),
    vec3(
      worldPosition.x,
      worldPosition.y.add(height).add(_forceBind),
      worldPosition.z
    )
  );

  return select(isLeaf, beforeTransform, vec3(0, 0, 0));
}).setLayout({
  name: "worldPosition",
  type: "vec3",
  inputs: [],
});
