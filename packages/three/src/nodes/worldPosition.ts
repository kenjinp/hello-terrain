import { float, Fn, instanceIndex, int, positionLocal, pow, select, vec3 } from "three/tsl";

import { StorageBufferNode } from "three/webgpu";
import { LeafStorageState } from "../tasks/quadtree.task";
import { TerrainUniformsContext } from "../tasks/uniforms/terrainUniforms";
import { readHeightAtPositionLocal } from "./elevation/heights";
import { isSkirtVertex } from "./skirt";

export function createTileWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  heightmapStorageNode?: StorageBufferNode,
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

    return vec3(worldX, worldY, worldZ);
  })();
}
