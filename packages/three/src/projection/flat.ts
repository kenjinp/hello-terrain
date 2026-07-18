import { Fn, float, int, pow, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { createFlatNormalFromElevationField } from '../gpu/normalField';
import type { TileComputeParts, TileComputePartsContext } from '../gpu/tile';
import { createFlatRenderVertexPosition } from '../gpu/worldPosition';
import { cpuRaycast } from '../query/cpu-raycast';
import { createTerrainQuery } from '../query/terrain-query';
import type {
    FieldNormalContext,
    FieldNormalFn,
    ProjectionRaycastContext,
    RenderVertexPositionContext,
    SurfaceProjection,
} from './types';

function createFlatTileComputeParts(ctx: TileComputePartsContext): TileComputeParts {
    const { uniforms, shared } = ctx;

    const tileSize = Fn(([nodeIndex]: [Node]) => {
        const level = shared.tileLevel(nodeIndex);
        const divisor = pow(float(2), level.toFloat());
        return float(uniforms.uRootSize.toVar()).div(divisor);
    });

    const rootUV = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
        const nodeVec2 = shared.tileOriginVec2(nodeIndex);
        const nodeX = nodeVec2.x;
        const nodeY = nodeVec2.y;
        const rootSize = uniforms.uRootSize.toVar();
        const rootOrigin = uniforms.uRootOrigin.toVar();
        const size = tileSize(nodeIndex);
        const half = float(0.5);
        const halfRoot = float(rootSize).mul(half);
        const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
        const texelSpacing = size.div(fInnerSegments);
        const absX = nodeX.mul(fInnerSegments).add(int(ix).toFloat().sub(float(1.0)));
        const absY = nodeY.mul(fInnerSegments).add(int(iy).toFloat().sub(float(1.0)));
        const worldX = rootOrigin.x.add(absX.mul(texelSpacing)).sub(halfRoot);
        const worldZ = rootOrigin.z.add(absY.mul(texelSpacing)).sub(halfRoot);
        const centeredX = worldX.sub(rootOrigin.x);
        const centeredZ = worldZ.sub(rootOrigin.z);
        return vec2(
            centeredX.div(rootSize).add(half),
            centeredZ.div(rootSize).mul(float(-1.0)).add(half)
        );
    });

    const tileVertexWorldPosition = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
        const rootOrigin = uniforms.uRootOrigin.toVar();
        const nodeVec2 = shared.tileOriginVec2(nodeIndex);
        const nodeX = nodeVec2.x;
        const nodeY = nodeVec2.y;
        const rootSize = uniforms.uRootSize.toVar();
        const size = tileSize(nodeIndex);
        const half = float(0.5);
        const halfRoot = float(rootSize).mul(half);
        const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
        const texelSpacing = size.div(fInnerSegments);
        const absX = nodeX.mul(fInnerSegments).add(int(ix).toFloat().sub(float(1.0)));
        const absY = nodeY.mul(fInnerSegments).add(int(iy).toFloat().sub(float(1.0)));
        const worldX = rootOrigin.x.add(absX.mul(texelSpacing)).sub(halfRoot);
        const worldZ = rootOrigin.z.add(absY.mul(texelSpacing)).sub(halfRoot);
        return vec3(worldX, rootOrigin.y, worldZ);
    });

    return {
        tileSize: (nodeIndex) => tileSize(nodeIndex),
        rootUV: (nodeIndex, ix, iy) => rootUV(nodeIndex, ix, iy),
        tileVertexWorldPosition: (nodeIndex, ix, iy) => tileVertexWorldPosition(nodeIndex, ix, iy),
    };
}

/** Flat heightfield projection: tiles in the XZ plane, elevation along +Y. */
export function createFlatProjection(): SurfaceProjection {
    return {
        kind: 'flat',
        cacheKey: 'flat',
        faceOutward: false,

        gpu: {
            renderVertexPosition(ctx: RenderVertexPositionContext): Node {
                return createFlatRenderVertexPosition(
                    ctx.leafStorage,
                    ctx.uniforms,
                    ctx.terrainFieldStorage,
                    ctx.tileBoundsNode,
                    ctx.visibleSlotStorage
                );
            },
            createTileComputeParts: createFlatTileComputeParts,
            createFieldNormal(ctx: FieldNormalContext): FieldNormalFn {
                const computeNormal = createFlatNormalFromElevationField(
                    ctx.elevationFieldNode,
                    ctx.edgeVertexCount
                );
                return (nodeIndex, ix, iy) =>
                    computeNormal(
                        nodeIndex,
                        ctx.tile.tileSize(nodeIndex),
                        ix,
                        iy,
                        ctx.uniforms.uElevationScale
                    );
            },
        },

        cpu: {
            createSurfaceOps() {
                return null;
            },
            createRuntimeQueries(cache) {
                return { query: createTerrainQuery(cache), surfaceQuery: null, sphereQuery: null };
            },
            raycast(ctx: ProjectionRaycastContext) {
                const { ray, options, terrainQuery, config } = ctx;
                if (!terrainQuery) return null;
                return cpuRaycast(terrainQuery, ray, config, options);
            },
        },
    };
}
