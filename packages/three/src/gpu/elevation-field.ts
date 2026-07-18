import { int } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { TerrainUniformsContext } from '../types';
import type { createTileCompute } from './tile';
import type { ElevationReturn } from '../tsl/elevation';

export const createElevation = (
    tile: ReturnType<typeof createTileCompute>,
    uniforms: TerrainUniformsContext,
    elevationFn: ElevationReturn
) => {
    return function perVertexElevation(nodeIndex: Node, localCoordinates: Node) {
        const ix = int(localCoordinates.x);
        const iy = int(localCoordinates.y);
        const edgeVertexCount = uniforms.uInnerTileSegments.toVar().add(int(3));
        const tileUV = localCoordinates.toFloat().div(edgeVertexCount.toFloat());
        const rootUV = tile.rootUVCompute(nodeIndex, ix, iy);

        const worldPosition = tile
            .tileVertexWorldPositionCompute(nodeIndex, ix, iy)
            .setName('worldPositionWithSkirt');

        const rootSize = uniforms.uRootSize.toVar();
        return elevationFn({
            worldPosition,
            rootSize,
            rootUV,
            tileOriginVec2: tile.tileOriginVec2(nodeIndex),
            tileSize: tile.tileSize(nodeIndex),
            tileLevel: tile.tileLevel(nodeIndex),
            nodeIndex: int(nodeIndex),
            tileUV,
        });
    };
};
