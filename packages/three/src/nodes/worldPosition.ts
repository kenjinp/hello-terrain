import { float, Fn, instanceIndex, int, normalLocal, positionLocal, pow, select, unpackHalf2x16, vec3, vertexIndex } from "three/tsl";

import type { Node } from "three/webgpu";
import { StorageBufferNode } from "three/webgpu";
import { LeafStorageState } from "../tasks/quadtree.task";
import { TerrainUniformsContext } from "../tasks/uniforms/terrainUniforms";
import { readHeightAtPositionLocal } from "./elevation/heights";
import { deriveNormalZ } from "./materials";
import { isSkirtVertex } from "./skirt";

export function createTileWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  heightmapStorageNode?: StorageBufferNode,
  normalmapStorageNode?: Node,
) {
  return Fn(() => {
    const edgeVertexCount = terrainUniforms.uInnerTileSegments.add(3);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const nodeIndex = int(instanceIndex);
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeLevel = leafStorage.node.element(nodeOffset).toInt();
    const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();

    const rootSize = terrainUniforms.uRootSize.toVar();
    const rootOrigin = terrainUniforms.uRootOrigin.toVar();
    const half = float(0.5);
    const size = rootSize.div(pow(float(2), nodeLevel.toFloat()));
    const halfRoot = rootSize.mul(half);

    const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
    const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

    const clampedX = positionLocal.x.max(half.negate()).min(half);
    const clampedZ = positionLocal.z.max(half.negate()).min(half);

    const worldX = centerX.add(clampedX.mul(size));
    const worldZ = centerZ.add(clampedZ.mul(size));
    const baseY = rootOrigin.y;

    // Read elevation from heightmap buffer if available, scaled by uHeightmapScale
    const elevation = heightmapStorageNode
      ? readHeightAtPositionLocal(heightmapStorageNode, edgeVertexCount, positionLocal)().mul(
          terrainUniforms.uHeightmapScale,
        )
      : float(0);

    const skirtY = baseY.add(elevation).sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, baseY.add(elevation));

    // Read normal from normalmap buffer per-vertex and assign to normalLocal.
    // The material's default pipeline transforms normalLocal → normalView for lighting.
    // Uses vertexIndex (not positionLocal) for reliable grid-to-buffer mapping.
    if (normalmapStorageNode) {
      const intEdge = int(edgeVertexCount);
      const verticesPerNode = intEdge.mul(intEdge);
      const globalVertexIndex = nodeIndex.mul(verticesPerNode).add(int(vertexIndex));
      const packed = normalmapStorageNode.element(globalVertexIndex);
      const normalXZ = unpackHalf2x16(packed);
      // deriveNormalZ returns vec3(X, Z, Y_derived); swizzle to Y-up convention
      const reconstructed = deriveNormalZ(normalXZ);
      normalLocal.assign(vec3(reconstructed.x, reconstructed.z, reconstructed.y));
    }

    return vec3(worldX, worldY, worldZ);
  })();
}
