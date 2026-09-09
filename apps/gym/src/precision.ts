import { Fn, globalId, int, storage, vec4, positionView, float } from 'three/tsl';
import {
    StorageBufferAttribute,
    WebGPURenderer,
    Scene,
    OrthographicCamera,
    MeshBasicNodeMaterial,
    RenderTarget,
    FloatType,
    Vector3,
    Matrix4,
    NoToneMapping,
} from 'three/webgpu';
import { createTerrain } from '../../../packages/three/src/runtime/three';
import { createTerrainBinding } from '../../../packages/three/src/runtime/binding';
import { createCubeSphereTopology } from '../../../packages/three/src/quadtree/topology/cubeSphere';
import { createCubeSphereProjection } from '../../../packages/three/src/projection/cubeSphere';
import { createLeafStorage } from '../../../packages/three/src/gpu/leafStorage';
import { createTerrainUniforms } from '../../../packages/three/src/gpu/uniforms';
import { createTileCompute } from '../../../packages/three/src/gpu/tile';
import { cubeSphereDatum } from '../../../packages/three/src/runtime/precision';
import { numericAssertion } from '../../../packages/three/gym/oracles';
import type { GymResult } from '../../../packages/three/gym/report';
import { compareDatumRepresentations } from './datumComparison';
import { measureShadowIntegration } from './shadow';

export async function runPrecision(capabilities: GymResult['capabilities']): Promise<GymResult> {
    const renderer = new WebGPURenderer();
    await renderer.init();
    const errors: string[] = [];
    const device = (renderer.backend as unknown as { device: GPUDevice }).device;
    device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
    const result: GymResult = {
        status: 'passed',
        capabilities,
        assertions: [],
        metrics: {},
        samples: [],
    };
    const radius = 6371007.2,
        segments = 61,
        edge = segments + 3;
    const tiles = [14, 16, 17, 20].flatMap((level) =>
        Array.from({ length: 6 }, (_, face) =>
            [
                [0.731, 0.417],
                [0, 0],
                [0, 1],
                [1, 0],
                [1, 1],
                [0, 0.5],
                [1, 0.5],
                [0.5, 0],
                [0.5, 1],
            ].map(([u, v]) => ({
                level,
                face,
                x: Math.min(2 ** level - 1, Math.floor(2 ** level * u!)),
                y: Math.min(2 ** level - 1, Math.floor(2 ** level * v!)),
            }))
        ).flat()
    );
    const leafStorage = createLeafStorage(tiles.length);
    tiles.forEach((tile, i) => leafStorage.data.set([tile.level, tile.x, tile.y, tile.face], i * 4));
    const uniforms = createTerrainUniforms({
        rootOrigin: { x: 0, y: 0, z: 0 },
        rootSize: 1,
        innerTileSegments: segments,
        skirtScale: 0,
        elevationScale: 1,
        radius,
        instanceId: crypto.randomUUID(),
    });
    const projection = createCubeSphereProjection({ radius });
    const tile = createTileCompute(leafStorage, uniforms, projection);
    const elevation = new StorageBufferAttribute(new Float32Array(tiles.length * edge * edge), 1);
    const output = new StorageBufferAttribute(new Float32Array(tiles.length * edge * edge * 4), 4);
    const elevationNode = storage(elevation, 'float', elevation.count);
    const outputNode = storage(output, 'vec4', output.count);
    const normal = projection.gpu.createFieldNormal({
        elevationFieldNode: elevationNode,
        edgeVertexCount: edge,
        tile,
        uniforms,
    });
    const kernel = Fn(() => {
        const ix = int(globalId.x),
            iy = int(globalId.y),
            node = int(globalId.z);
        outputNode
            .element(
                node
                    .mul(edge * edge)
                    .add(iy.mul(edge))
                    .add(ix)
            )
            .assign(vec4(normal(node, ix, iy), 1));
    })().computeKernel([8, 8, 1]);
    try {
        renderer.compute(kernel, [edge / 8, edge / 8, tiles.length]);
        const values = new Float32Array(await renderer.getArrayBufferAsync(output));
        for (const level of [14, 16, 17, 20]) {
            const angles: number[] = [];
            tiles.forEach((tile, i) => {
                if (tile.level !== level) return;
                for (let y = 1; y < edge - 1; y++)
                    for (let x = 1; x < edge - 1; x++) {
                        const expected = cubeSphereDatum(
                            [0, 0, 0],
                            tile.face,
                            (tile.x + (x - 1) / segments) / 2 ** level,
                            (tile.y + (y - 1) / segments) / 2 ** level,
                            1
                        );
                        const offset = (i * edge * edge + y * edge + x) * 4;
                        const n = [values[offset], values[offset + 1], values[offset + 2]];
                        const length = Math.hypot(...n);
                        const dot = n.reduce((sum, v, axis) => sum + v * expected[axis]!, 0) / length;
                        angles.push((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI);
                    }
            });
            const max = angles.reduce((a, b) => Math.max(a, b), 0),
                mean = angles.reduce((a, b) => a + b, 0) / angles.length;
            result.metrics[`normalMaxDegreesL${level}`] = max;
            result.metrics[`normalMeanDegreesL${level}`] = mean;
            result.assertions.push(
                numericAssertion(`Earth constant datum normals L${level}`, `L${level}`, max, 0, 0.5)
            );
            result.samples.push({
                level,
                radius,
                segments,
                sampleCount: angles.length,
                maxDegrees: max,
                meanDegrees: mean,
            });
        }
        if (errors.length) throw new Error(errors.join('\n'));
        await measureEarthRender(renderer, result, radius);
        await compareDatumRepresentations(renderer, result);
        await measureShadowIntegration(renderer, result);
        result.status = result.assertions.some((a) => !a.pass) ? 'failed' : 'passed';
        return result;
    } finally {
        await device.queue.onSubmittedWorkDone();
        kernel.dispose();
        renderer.dispose();
    }
}

async function measureEarthRender(renderer: WebGPURenderer, result: GymResult, radius: number) {
    const material = new MeshBasicNodeMaterial();
    material.outputNode = vec4(positionView, 1);
    const terrain = createTerrain({
        renderer,
        topology: createCubeSphereTopology({ radius }),
        innerTileSegments: 61,
        maxNodes: 512,
        maxLevel: 20,
        skirtScale: 0,
        elevation: () => float(0),
        elevationRange: { min: 0, max: 0 },
        terrainFieldFormat: 'rgba32float',
        queries: { readback: 'disabled' },
    });
    const binding = createTerrainBinding(terrain, { material });
    const scene = new Scene();
    scene.add(binding.mesh);
    const target = new RenderTarget(16, 16, { type: FloatType });
    renderer.toneMapping = NoToneMapping;
    try {
        const axes = [
            [0.31, 0.57, 0.76],
            [0.71, -0.29, 0.64],
        ];
        for (const x of [-1, 0, 1])
            for (const y of [-1, 0, 1])
                for (const z of [-1, 0, 1]) {
                    if (Math.abs(x) + Math.abs(y) + Math.abs(z) >= 2) axes.push([x, y, z]);
                }
        const transformedIndex = axes.length;
        axes.push([0.31, 0.57, 0.76], [0.31, 0.57, 0.76]);
        let previousDepth: Float32Array | null = null;
        for (const [index, axis] of axes.entries()) {
            const direction = new Vector3(...axis).normalize();
            const camera = new OrthographicCamera(-4, 4, 4, -4, 0.1, 1000);
            if (index === transformedIndex) {
                binding.mesh.position.set(1e9, -2e8, 3e8);
                binding.mesh.rotation.set(0.3, -0.5, 0.2);
                binding.mesh.scale.set(1.2, 0.8, 1.1);
            }
            binding.mesh.updateMatrixWorld(true);
            camera.position
                .copy(direction)
                .multiplyScalar(radius + 30)
                .applyMatrix4(binding.mesh.matrixWorld);
            camera.lookAt(
                direction.clone().multiplyScalar(radius).applyMatrix4(binding.mesh.matrixWorld)
            );
            camera.updateMatrixWorld();
            const viewToLocal = new Matrix4()
                .copy(binding.mesh.matrixWorld)
                .invert()
                .multiply(camera.matrixWorld);
            const rayDirection = new Vector3(0, 0, -1)
                .applyMatrix4(viewToLocal)
                .sub(new Vector3().applyMatrix4(viewToLocal));
            if (index === transformedIndex + 1)
                terrain.configure({ maxLevel: 19, innerTileSegments: 31 });
            const production = await terrain.update(binding.viewFromCamera(camera, 16));
            if (production.status === 'error') throw production.error;
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
            const values = new Float32Array(
                (await renderer.readRenderTargetPixelsAsync(target, 0, 0, 16, 16)).buffer
            );
            let maxError = 0,
                covered = 0;
            for (let y = 4; y < 12; y++)
                for (let x = 4; x < 12; x++) {
                    const offset = (y * 16 + x) * 4;
                    if (values[offset + 3]! < 0.5) continue;
                    // f64 analytic ray/ellipsoid oracle, with cancellation-resistant c.
                    const px = ((x + 0.5) / 16) * 8 - 4,
                        py = 4 - ((y + 0.5) / 16) * 8;
                    // Raster interpolation has its own subpixel error; this oracle measures depth.
                    const origin = new Vector3(px, py, 0).applyMatrix4(viewToLocal);
                    const length = origin.length(),
                        c = (length - radius) * (length + radius);
                    const b = origin.dot(rayDirection),
                        a = rayDirection.lengthSq();
                    const distance = c / (-b + Math.sqrt(b * b - a * c));
                    const expectedZ = -distance;
                    if (x === 4 && y === 4)
                        result.samples.push({
                            camera: index,
                            actual: Array.from(values.slice(offset, offset + 3)),
                            expected: [px, py, expectedZ],
                            ray: rayDirection.toArray(),
                            matrix: viewToLocal.elements,
                        });
                    maxError = Math.max(maxError, Math.abs(values[offset + 2]! - expectedZ));
                    covered++;
                }
            if (index === transformedIndex + 1 && previousDepth) {
                let temporal = 0;
                for (let y = 4; y < 12; y++)
                    for (let x = 4; x < 12; x++) {
                        const offset = (y * 16 + x) * 4 + 2;
                        temporal = Math.max(
                            temporal,
                            Math.abs(values[offset]! - previousDepth[offset]!)
                        );
                    }
                result.metrics.reconfigurationDepthChangeMeters = temporal;
                result.assertions.push(
                    numericAssertion(
                        'Earth depth through LOD/grid reconfiguration',
                        'temporal',
                        temporal,
                        0,
                        0.01
                    )
                );
            }
            previousDepth = values;
            result.metrics[`renderDepthMaxErrorMeters${index}`] = maxError;
            result.assertions.push(
                numericAssertion(
                    `Earth camera ${index} depth residual`,
                    `camera-${index}`,
                    maxError,
                    0,
                    0.01
                )
            );
            result.assertions.push(
                numericAssertion(`Earth camera ${index} coverage`, `camera-${index}`, covered, 64, 0)
            );
        }
    } finally {
        renderer.setRenderTarget(null);
        await binding.dispose();
        await terrain.dispose();
        material.dispose();
        target.dispose();
    }
}
