import {
    float,
    max,
    pow,
    varyingProperty,
    vec2,
    positionView,
    transformNormalToView,
    Fn,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

/** Vertex-produced values interpolated for ordinary fragment TSL composition. */
export function createTerrainMaterialContext() {
    const elevation = varyingProperty('float');
    const datumNormalLocal = varyingProperty('vec3');
    const baseNormalLocal = varyingProperty('vec3');
    const datumPositionLocal = varyingProperty('vec3');
    const sourceUV = varyingProperty('vec2');
    const sourceFace = varyingProperty('float');
    const tileOriginVec2 = varyingProperty('vec2'),
        tileLevel = varyingProperty('float'),
        tileLocalUV = varyingProperty('vec2');
    return {
        /** Scaled displacement in terrain units, before skirt extrusion. */
        elevation,
        datumNormalLocal,
        baseNormalLocal,
        datumPositionLocal,
        sourceUV,
        sourceFace,
        tileOriginVec2,
        tileLevel,
        tileLocalUV,
        /** Cosine relative to datum, independent of user detail shading normals. */
        slopeCosine: baseNormalLocal.normalize().dot(datumNormalLocal.normalize()).clamp(-1, 1),
    };
}

/** Fixed face chart: integer tile differences precede local fractional addition. */
export function createRegionalSourceMapping(options: {
    face: number;
    level: number;
    x: number;
    y: number;
}) {
    const { face, level, x, y } = options;
    if (![face, level, x, y].every(Number.isInteger) || level < 0 || level > 24)
        throw new Error('Invalid fixed source region');
    return {
        uv(input: { tileOriginVec2: Node; tileLevel: Node; tileLocalUV?: Node }) {
            if (!input.tileLocalUV)
                throw new Error(
                    'Regional mapping requires production datum coordinates in this shader stage'
                );
            const scale = pow(2, input.tileLevel.toFloat().sub(level));
            return input.tileOriginVec2.sub(vec2(x, y).mul(scale)).add(input.tileLocalUV).div(scale);
        },
        appliesTo(sourceFace: Node) {
            return sourceFace.equal(face);
        },
    };
}
export type TerrainMaterialContext = ReturnType<typeof createTerrainMaterialContext>;

/** Mapping belongs to a sampler/binding, so shared textures remain untouched. */
export function createSourceMapping(
    options: { offset?: [number, number]; scale?: [number, number]; face?: number } = {}
) {
    const offset = [...(options.offset ?? [0, 0])] as [number, number];
    const scale = [...(options.scale ?? [1, 1])] as [number, number];
    const face = options.face;
    return {
        uv: (uv: Node) => uv.mul(vec2(...scale)).add(vec2(...offset)),
        appliesTo: (sourceFace: Node) =>
            face === undefined ? float(1) : sourceFace.equal(face).toFloat(),
    };
}

/** Normalize only authored blend weights; masks and categorical IDs stay separate. */
export function terrainWeights(channels: Node[], fallback = 0): Node[] {
    if (!channels.length || fallback < 0 || fallback >= channels.length)
        throw new Error('Invalid weight fallback');
    const weights = channels.map((channel) => channel.max(0));
    const sum = weights.reduce<Node>((a, b) => a.add(b), float(0));
    return weights.map((weight, index) =>
        sum.greaterThan(0).select(weight.div(max(sum, 1e-20)), float(index === fallback ? 1 : 0))
    );
}

/** Fragment normalNode in view space, using the SAME mapping as the normal texture. */
export function terrainDetailNormal(
    context: TerrainMaterialContext,
    encodedNormal: Node,
    mappingUV: Node
): Node {
    return Fn(() => {
        const n = transformNormalToView(context.baseNormalLocal.normalize()).normalize();
        const q0 = positionView.dFdx(),
            q1 = positionView.dFdy();
        const st0 = mappingUV.dFdx(),
            st1 = mappingUV.dFdy();
        const q1perp = q1.cross(n),
            q0perp = n.cross(q0);
        const t = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
        const b = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
        const lengthSquared = t.dot(t).max(b.dot(b));
        const scale = lengthSquared
            .greaterThan(0)
            .select(lengthSquared.max(1e-30).inverseSqrt(), float(0));
        const detail = encodedNormal.mul(2).sub(1);
        return t
            .mul(scale)
            .mul(detail.x)
            .add(b.mul(scale).mul(detail.y))
            .add(n.mul(detail.z))
            .normalize();
    })();
}
