import {
    Fn,
    float,
    instanceIndex,
    int,
    modelViewMatrix,
    positionGeometry,
    pow,
    select,
    storage,
    vec3,
    vec4,
    sin,
    cos,
} from 'three/tsl';
import { Matrix4, StorageBufferAttribute, type Node, type NodeFrame } from 'three/webgpu';
import { vec3 as cpuVec3, type Vec3 } from 'math';
import { torusUVToPoint } from '../quadtree/topology/torusInverse';
import { cubeSphereDatum } from '../runtime/precision';
import { cubeFaceBasis, cubeFacePoint } from '../tsl/cubeSphere';
import { decodeLeafTile } from './tile';
import { isSkirtVertex } from '../tsl/skirt';
import type { LeafStorageState, TerrainUniformsContext } from '../types';
import type { TerrainMaterialContext } from '../tsl/terrainMaterial';

/** Stable small residual for normalize(anchorCube + deltaCube), retaining curvature. */
export function sphereDatumResidual(anchorCube: Node, deltaCube: Node, radius: Node): Node {
    const la = anchorCube.length();
    const lc = anchorCube.add(deltaCube).length();
    const lengthDifference = anchorCube.dot(deltaCube).mul(2).add(deltaCube.dot(deltaCube));
    return deltaCube
        .div(lc)
        .sub(anchorCube.mul(lengthDifference.div(la.mul(lc).mul(la.add(lc)))))
        .mul(radius);
}

type PrecisionOptions = {
    positionNode: Node;
    leafStorage: LeafStorageState;
    uniforms: TerrainUniformsContext;
    materialContext: TerrainMaterialContext;
};

/** Explicit r182 integration: positionView uses f64 CPU anchors in every camera pass. */
function createAnchoredPosition(
    options: PrecisionOptions,
    residual: Node,
    datum: (level: number, x: number, y: number, face: number, out: Vec3) => void
) {
    const { leafStorage } = options;
    const capacity = leafStorage.data.length / 4;
    const anchors = new Float64Array(capacity * 3);
    const viewData = new Float32Array(capacity * 4);
    const attribute = new StorageBufferAttribute(viewData, 4);
    const anchorNode = storage(attribute, 'vec4', capacity).toReadOnly();
    const modelView = new Matrix4();
    let count = 0;
    anchorNode.onObjectUpdate((frame: NodeFrame) => {
        if (!frame.camera || !frame.object) return attribute;
        modelView.multiplyMatrices(frame.camera.matrixWorldInverse, frame.object.matrixWorld);
        const m = modelView.elements;
        for (let i = 0; i < count; i++) {
            const x = anchors[i * 3]!,
                y = anchors[i * 3 + 1]!,
                z = anchors[i * 3 + 2]!;
            // All products and cancellation use JS binary64, then round small results.
            viewData[i * 4] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
            viewData[i * 4 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
            viewData[i * 4 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        }
        attribute.needsUpdate = true;
        return attribute;
    });
    const positionNode = Fn((builder: any) => {
        // Embedded in positionNode so Three's shadow override receives the same
        // per-camera view calculation. Absolute source/world position stays intact.
        builder.context.setupPositionView = () =>
            modelViewMatrix
                .mul(vec4(residual, 0))
                .xyz.add(anchorNode.element(int(instanceIndex)).xyz);
        return options.positionNode;
    })();
    const scratch: Vec3 = cpuVec3.create();
    return {
        positionNode,
        attribute,
        update(nextCount: number) {
            count = nextCount;
            for (let i = 0; i < count; i++) {
                datum(
                    leafStorage.data[i * 4]!,
                    leafStorage.data[i * 4 + 1]!,
                    leafStorage.data[i * 4 + 2]!,
                    leafStorage.data[i * 4 + 3]!,
                    scratch
                );
                anchors.set(scratch, i * 3);
            }
        },
    };
}

export function createSpherePrecisionPosition(
    options: PrecisionOptions & {
        radius: number;
        center: { x: number; y: number; z: number };
        invert: boolean;
    }
) {
    const { leafStorage, uniforms, materialContext, radius, center, invert } = options;
    const residual = Fn(() => {
        const tile = decodeLeafTile(leafStorage, int(instanceIndex));
        const scale = pow(2, tile.level.toFloat());
        const basis = cubeFaceBasis(tile.face);
        const anchorUV = tile.x.add(0.5).div(scale);
        const anchorV = tile.y.add(0.5).div(scale);
        const anchorCube = cubeFacePoint(basis, anchorUV, anchorV);
        const grid = positionGeometry;
        const localX = grid.x.clamp(-0.5, 0.5),
            localZ = grid.z.clamp(-0.5, 0.5);
        const delta = basis.right
            .mul(localX.mul(2).div(scale))
            .add(basis.up.mul(localZ.mul(2).div(scale)));
        const datum = sphereDatumResidual(anchorCube, delta, float(radius));
        const skirt = isSkirtVertex(uniforms.uInnerTileSegments);
        const h = materialContext.elevation.sub(select(skirt, uniforms.uSkirtScale, float(0)));
        const direction = anchorCube.add(delta).normalize();
        return datum.add(direction.mul(invert ? h.negate() : h));
    })();
    return createAnchoredPosition(options, residual, (level, x, y, face, out) => {
        cubeSphereDatum(out, face, (x + 0.5) / 2 ** level, (y + 0.5) / 2 ** level, radius);
        out[0] += center.x;
        out[1] += center.y;
        out[2] += center.z;
    });
}

export function createFlatPrecisionPosition(options: PrecisionOptions) {
    const { leafStorage, uniforms, materialContext } = options;
    const rootSize = uniforms.uRootSize.value;
    const center = uniforms.uRootOrigin.value;
    const residual = Fn(() => {
        const tile = decodeLeafTile(leafStorage, int(instanceIndex));
        const size = uniforms.uRootSize.div(pow(2, tile.level.toFloat()));
        const grid = positionGeometry;
        const skirt = isSkirtVertex(uniforms.uInnerTileSegments);
        return vec3(
            grid.x.clamp(-0.5, 0.5).mul(size),
            materialContext.elevation.sub(select(skirt, uniforms.uSkirtScale, float(0))),
            grid.z.clamp(-0.5, 0.5).mul(size)
        );
    })();
    return createAnchoredPosition(options, residual, (level, x, y, _face, out) => {
        const size = rootSize / 2 ** level;
        cpuVec3.set(
            out,
            center.x + (x + 0.5) * size - rootSize / 2,
            center.y,
            center.z + (y + 0.5) * size - rootSize / 2
        );
    });
}

export function createTorusPrecisionPosition(
    options: PrecisionOptions & {
        majorRadius: number;
        minorRadius: number;
        center: { x: number; y: number; z: number };
        baseU: number;
        baseV: number;
        invert: boolean;
    }
) {
    const {
        leafStorage,
        uniforms,
        materialContext,
        majorRadius,
        minorRadius,
        center,
        baseU,
        baseV,
        invert,
    } = options;
    const residual = Fn(() => {
        const tile = decodeLeafTile(leafStorage, int(instanceIndex));
        const scale = pow(2, tile.level.toFloat());
        const theta = tile.x
            .add(0.5)
            .mul((2 * Math.PI) / baseU)
            .div(scale);
        const phi = tile.y
            .add(0.5)
            .mul((2 * Math.PI) / baseV)
            .div(scale);
        const grid = positionGeometry;
        const dt = grid.x
            .clamp(-0.5, 0.5)
            .mul((2 * Math.PI) / baseU)
            .div(scale);
        const dp = grid.z
            .clamp(-0.5, 0.5)
            .mul((2 * Math.PI) / baseV)
            .div(scale);
        // Trigonometric difference identities retain tiny angular offsets.
        const dsT = cos(theta.add(dt.mul(0.5)))
            .mul(sin(dt.mul(0.5)))
            .mul(2);
        const dcT = sin(theta.add(dt.mul(0.5)))
            .mul(sin(dt.mul(0.5)))
            .mul(-2);
        const dsP = cos(phi.add(dp.mul(0.5)))
            .mul(sin(dp.mul(0.5)))
            .mul(2);
        const dcP = sin(phi.add(dp.mul(0.5)))
            .mul(sin(dp.mul(0.5)))
            .mul(-2);
        const sT = sin(theta).add(dsT),
            cT = cos(theta).add(dcT);
        const sP = sin(phi).add(dsP),
            cP = cos(phi).add(dcP);
        const rho = cos(phi).mul(minorRadius).add(majorRadius);
        const dRho = dcP.mul(minorRadius);
        const datum = vec3(
            rho.mul(dsT).add(dRho.mul(sT)),
            dsP.mul(minorRadius),
            rho.mul(dcT).add(dRho.mul(cT))
        );
        const skirt = isSkirtVertex(uniforms.uInnerTileSegments);
        const h = materialContext.elevation
            .sub(select(skirt, uniforms.uSkirtScale, float(0)))
            .mul(invert ? -1 : 1);
        return datum.add(vec3(cP.mul(sT), sP, cP.mul(cT)).mul(h));
    })();
    return createAnchoredPosition(options, residual, (level, x, y, _face, out) => {
        torusUVToPoint(
            (x + 0.5) / (baseU * 2 ** level),
            (y + 0.5) / (baseV * 2 ** level),
            majorRadius,
            minorRadius,
            0,
            center,
            out,
            invert
        );
    });
}
