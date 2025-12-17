import {
  Fn,
  float,
  instanceIndex,
  int,
  positionLocal,
  select,
  vec2,
  vec3,
  vertexIndex,
} from "three/tsl";
import type { TerrainUniforms } from "../TerrainUniforms";
import type { TerrainVaryings } from "../TerrainVaryings";
import { createReadNormalAtPositionLocal } from "./normals";
import {
  activeLeafIndicesStorageProperty,
  controlmapStorageProperty,
  heightmapStorageProperty,
  nodeStorageProperty,
  normalmapStorageProperty,
} from "./properties";
import { createIsSkirtVertex } from "./skirt";
import { createTileGeometryPosition, createTileIsLeaf } from "./tile";

export const createWorldPosition = (
  uniforms: TerrainUniforms,
  varyings: TerrainVaryings
) => {
  const tileIsLeaf = createTileIsLeaf();
  const isSkirtVertex = createIsSkirtVertex(uniforms);
  const tileGeometryPosition = createTileGeometryPosition(uniforms);

  return Fn(() => {
    // Use indirection: look up actual node index from active leaf indices
    const activeIndex = int(instanceIndex);
    const nodeIndex = int(
      activeLeafIndicesStorageProperty.element(activeIndex)
    );
    const skirtVertex = isSkirtVertex();
    const worldPos = tileGeometryPosition(
      nodeIndex,
      positionLocal,
      skirtVertex
    );
    const isLeaf = tileIsLeaf(nodeIndex);

    // Force a zero-effect dependency on nodeStorageProperty so the renderer
    // declares and binds the read-only storage buffer for the vertex stage.
    const _forceBind = nodeStorageProperty
      .element(int(0))
      .toFloat()
      .mul(0)
      .add(normalmapStorageProperty.element(int(0)).toFloat().mul(0))
      .add(controlmapStorageProperty.element(int(0)).toFloat().mul(0));

    // Compute and pass global vertex index to fragment stage
    const edgeVertexCount = uniforms.uSegments.toVar().add(3);
    const intEdgeVertexCount = int(edgeVertexCount);
    const verticesPerNode = intEdgeVertexCount.mul(intEdgeVertexCount);
    const globalIndex = nodeIndex.mul(verticesPerNode).add(int(vertexIndex));
    varyings.vGlobalVertexIndex.assign(globalIndex);

    const height = heightmapStorageProperty
      .element(varyings.vGlobalVertexIndex)
      .mul(uniforms.uHeightmapScale.toVar());
    varyings.vElevation.assign(height);

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
      .mul(uniforms.uHeightmapScale.toVar());

    const beforeTransform = select(
      skirtVertex,
      vec3(
        worldPos.x,
        worldPos.y.add(skirtEdgeHeight).add(_forceBind),
        worldPos.z
      ),
      vec3(worldPos.x, worldPos.y.add(height).add(_forceBind), worldPos.z)
    );

    // Read normal from normalmap storage using the computed global index
    // (can't use varyings.vGlobalVertexIndex here as varyings are write-only in vertex stage)
    const readNormalAtPositionLocal =
      createReadNormalAtPositionLocal(globalIndex);
    varyings.vNormal.assign(readNormalAtPositionLocal());

    // Pass node metadata for 4-vertex control map sampling in fragment shader
    // These allow the fragment shader to calculate neighboring vertex indices
    // from world position without crossing node boundaries (skirt provides overlap)
    // Control data is read directly from storage in the fragment shader.
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeX = nodeStorageProperty.element(nodeOffset.add(int(1))).toFloat();
    const nodeZ = nodeStorageProperty.element(nodeOffset.add(int(2))).toFloat();
    const rootSize = uniforms.uRootSize.toVar();
    const nodeLevel = nodeStorageProperty.element(nodeOffset).toInt();
    const nodeSize = float(rootSize).div(float(2).pow(nodeLevel.toFloat()));
    const half = float(0.5);
    const halfRoot = float(rootSize).mul(half);
    const rootOrigin = uniforms.uRootOrigin.toVar();
    // Compute tile center in world space (same calculation as createTileGeometryPosition)
    const nodeCenterX = rootOrigin.x
      .add(nodeX.add(half).mul(nodeSize))
      .sub(halfRoot);
    const nodeCenterZ = rootOrigin.z
      .add(nodeZ.add(half).mul(nodeSize))
      .sub(halfRoot);

    varyings.vNodeIndex.assign(nodeIndex);
    varyings.vNodeOrigin.assign(vec2(nodeCenterX, nodeCenterZ));
    varyings.vNodeSize.assign(nodeSize);

    return select(isLeaf, beforeTransform, vec3(0, 0, 0));
  });
};
