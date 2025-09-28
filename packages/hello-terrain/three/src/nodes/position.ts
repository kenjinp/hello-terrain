import {
  Fn,
  instanceIndex,
  positionLocal,
  select,
  vec3,
  vertexIndex,
} from "three/tsl";
import { isSkirtVertex } from "./skirt";
import { uRootOrigin, uRootSize, uSkirtLength } from "./uniforms";
import { vElevation, vGlobalVertexIndex } from "./varyings";

export const positionNode = /*@__PURE__*/ Fn(() => {
  const nodeIndex = instanceIndex;
  const rootSize = uRootSize.toVar();
  const rootOrigin = uRootOrigin.toVar();
  const skirtLength = uSkirtLength.toVar();
  const worldPosition = tileGeometryPosition(
    nodeIndex,
    nodeStorage,
    rootSize,
    rootOrigin,
    positionLocal,
    skirtLength
  );
  const isLeaf = tileIsLeaf(nodeIndex, nodeStorage);

  // Compute and pass global vertex index to fragment stage
  const edgeVertexCount = uSegments.toVar().add(3);
  const intEdgeVertexCount = int(edgeVertexCount);
  const verticesPerNode = intEdgeVertexCount.mul(intEdgeVertexCount);
  const globalIndex = nodeIndex.mul(verticesPerNode).add(vertexIndex);
  vGlobalVertexIndex.assign(globalIndex);

  const height = helloTerrainMesh.heightmapNode
    .element(vGlobalVertexIndex)
    .mul(elevationUniforms.uHeightmapScale.toVar());
  vElevation.assign(height);

  const beforeTransform = select(
    isSkirtVertex(),
    vec3(worldPosition.x, worldPosition.y, worldPosition.z),
    vec3(worldPosition.x, worldPosition.y.add(height), worldPosition.z)
  );

  return select(isLeaf, beforeTransform, vec3(0, 0, 0));
});
