import { Fn, int, select, uint, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainUniforms } from "../TerrainUniforms";
import type { StorageBuffer } from "../compute/StorageBuffer";
import type { ControlReturn } from "./ControlFn";
import { nodeStorageProperty } from "./properties";
import {
  createRootUVCompute,
  createTileIsLeaf,
  createTileLevel,
  createTileOriginVec2,
  createTileSize,
  createTileVertexWorldPositionCompute,
} from "./tile";

/**
 * Creates a control map computation function for use in compute shaders.
 * Similar to createHeight, but:
 * - Samples height from heightmapStorage
 * - Samples normal from normalmapStorage
 * - Passes these to the user's controlFn
 * - Returns uint32 packed control data
 *
 * @param uniforms - Terrain uniforms for position/size calculations
 * @param controlFn - User-defined function that returns packed control data
 * @param heightmapStorage - Storage buffer containing computed heights
 * @param normalmapStorage - Storage buffer containing computed normals (3 floats per vertex)
 * @param _tileEdgeVertexCount - Number of vertices per tile edge (unused, kept for API consistency)
 */
export const createControl = (
  uniforms: TerrainUniforms,
  controlFn: ControlReturn,
  heightmapStorage: StorageBuffer,
  normalmapStorage: StorageBuffer,
  _tileEdgeVertexCount: number
) => {
  const tileIsLeaf = createTileIsLeaf();
  const rootUVCompute = createRootUVCompute(uniforms);
  const tileVertexWorldPositionCompute =
    createTileVertexWorldPositionCompute(uniforms);
  const tileOriginVec2 = createTileOriginVec2();
  const tileSize = createTileSize(uniforms);
  const tileLevel = createTileLevel();

  return (
    nodeIndex: Node,
    globalVertexIndex: Node,
    localUV: Node,
    _texelSize: Node
  ) =>
    Fn(() => {
      const isActive = nodeStorageProperty
        .element(nodeIndex.mul(4).add(3))
        .equal(int(1));
      const isLeaf = tileIsLeaf(nodeIndex);

      const resolveControl = Fn(() => {
        const rootUV = rootUVCompute(nodeIndex, localUV);

        const worldPosition = tileVertexWorldPositionCompute(
          nodeIndex,
          localUV
        ).setName("worldPositionControl");

        const rootSize = uniforms.uRootSize.toVar();

        // Sample height from heightmap storage at this vertex
        const height = heightmapStorage.storageNode
          .element(globalVertexIndex)
          .toVar();

        // Sample normal from normalmap storage (3 floats per vertex)
        const normalBaseIdx = int(globalVertexIndex).mul(int(3));
        const nx = normalmapStorage.storageNode.element(normalBaseIdx);
        const ny = normalmapStorage.storageNode.element(
          normalBaseIdx.add(int(1))
        );
        const nz = normalmapStorage.storageNode.element(
          normalBaseIdx.add(int(2))
        );
        const normal = vec3(nx, ny, nz).toVar();

        return controlFn({
          worldPosition,
          rootSize,
          rootUV,
          tileOriginVec2: tileOriginVec2(nodeIndex),
          tileSize: tileSize(nodeIndex),
          tileLevel: tileLevel(nodeIndex),
          nodeIndex: int(nodeIndex),
          tileUV: localUV,
          height,
          normal,
        });
      });

      // Return 0 (default texture) for inactive/non-leaf nodes
      return select(isActive.and(isLeaf), resolveControl(), uint(0));
    })();
};
