import { Fn, If, float, globalId, int, storage, vec4 } from 'three/tsl';
import { StorageBufferAttribute, type WebGPURenderer } from 'three/webgpu';
import { sphereDatumResidual } from '../../../packages/three/src/gpu/precision';
import { cubeSphereDatum } from '../../../packages/three/src/runtime/precision';
import { cubeFaceBasis, cubeFacePoint } from '../../../packages/three/src/tsl/cubeSphere';
import { numericAssertion } from '../../../packages/three/gym/oracles';
import type { GymResult } from '../../../packages/three/gym/report';

/** Matched point workload: analytic small residual versus cached f64 datum offsets. */
export async function compareDatumRepresentations(renderer: WebGPURenderer, result: GymResult) {
    const radius = 6371007.2,
        segments = 61,
        edge = segments + 1;
    const tiles = [14, 16, 17, 20].flatMap((level) =>
        Array.from({ length: 6 }, (_, face) => ({
            level,
            face,
            x: Math.floor(2 ** level * 0.731),
            y: Math.floor(2 ** level * 0.417),
        }))
    );
    const count = tiles.length * edge * edge;
    const reference = new Float64Array(count * 4),
        cached = new Float32Array(count * 4);
    const tileData = new Float32Array(tiles.length * 4);
    const start = performance.now();
    tiles.forEach((tile, i) => {
        const scale = 2 ** tile.level;
        tileData.set([tile.face, (tile.x + 0.5) / scale, (tile.y + 0.5) / scale, scale], i * 4);
        const anchor = cubeSphereDatum(
            [0, 0, 0],
            tile.face,
            (tile.x + 0.5) / scale,
            (tile.y + 0.5) / scale,
            radius
        );
        for (let y = 0; y < edge; y++)
            for (let x = 0; x < edge; x++) {
                const point = cubeSphereDatum(
                    [0, 0, 0],
                    tile.face,
                    (tile.x + x / segments) / scale,
                    (tile.y + y / segments) / scale,
                    radius
                );
                const offset = (i * edge * edge + y * edge + x) * 4;
                for (let axis = 0; axis < 3; axis++)
                    reference[offset + axis] = point[axis]! - anchor[axis]!;
            }
    });
    cached.set(reference);
    result.metrics.cachedDatumCpuBuildMs = performance.now() - start;
    result.metrics.cachedDatumBytes = cached.byteLength;
    result.metrics.analyticDatumAnchorBytes = tiles.length * 3 * 8;
    const attributes = [
        new StorageBufferAttribute(tileData, 4),
        new StorageBufferAttribute(cached, 4),
        new StorageBufferAttribute(new Float32Array(count * 4), 4),
    ];
    const tileNode = storage(attributes[0]!, 'vec4', tiles.length).toReadOnly();
    const cachedNode = storage(attributes[1]!, 'vec4', count).toReadOnly();
    const output = storage(attributes[2]!, 'vec4', count);
    const analytic = Fn(() => {
        const index = int(globalId.x),
            tileIndex = index.div(int(edge * edge)),
            local = index.mod(int(edge * edge));
        const tile = tileNode.element(tileIndex),
            basis = cubeFaceBasis(tile.x.toInt());
        const cube = cubeFacePoint(basis, tile.y, tile.z);
        const dx = local.mod(int(edge)).toFloat().div(segments).sub(0.5).mul(2).div(tile.w);
        const dy = local.div(int(edge)).toFloat().div(segments).sub(0.5).mul(2).div(tile.w);
        If(index.lessThan(int(count)), () => {
            output
                .element(index)
                .assign(
                    vec4(
                        sphereDatumResidual(
                            cube,
                            basis.right.mul(dx).add(basis.up.mul(dy)),
                            float(radius)
                        ),
                        0
                    )
                );
        });
    })().compute(count, [64]);
    const copy = Fn(() => {
        const index = int(globalId.x);
        If(index.lessThan(int(count)), () => {
            output.element(index).assign(cachedNode.element(index));
        });
    })().compute(count, [64]);
    const device = (renderer.backend as unknown as { device: GPUDevice }).device;
    try {
        for (const [name, kernel] of [
            ['analytic', analytic],
            ['cached', copy],
        ] as const) {
            renderer.compute(kernel);
            await device.queue.onSubmittedWorkDone(); // compile/upload warmup
            const timings: number[] = [];
            for (let repeat = 0; repeat < 3; repeat++) {
                const start = performance.now();
                renderer.compute(kernel);
                await device.queue.onSubmittedWorkDone();
                timings.push(performance.now() - start);
            }
            const values = new Float32Array(await renderer.getArrayBufferAsync(attributes[2]!));
            let error = 0,
                worst = 0;
            for (let i = 0; i < count; i++) {
                const delta = Math.hypot(
                    ...[0, 1, 2].map((axis) => values[i * 4 + axis]! - reference[i * 4 + axis]!)
                );
                if (delta > error) {
                    error = delta;
                    worst = i;
                }
            }
            result.samples.push({
                name,
                worst,
                tile: tiles[Math.floor(worst / (edge * edge))],
                actual: Array.from(values.slice(worst * 4, worst * 4 + 4)),
                expected: Array.from(reference.slice(worst * 4, worst * 4 + 4)),
            });
            result.metrics[`${name}DatumPositionMaxErrorMeters`] = error;
            result.metrics[`${name}DatumSubmissionMedianMs`] = timings.sort((a, b) => a - b)[1]!;
            result.assertions.push(
                numericAssertion(`${name} datum offset accuracy`, 'datum-comparison', error, 0, 0.01)
            );
            result.samples.push({
                representation: name,
                count,
                timings,
                error,
                timingScope:
                    'warm compute submission plus queue completion; not a GPU timestamp or full frame benchmark',
            });
        }
    } finally {
        await device.queue.onSubmittedWorkDone();
        analytic.dispose();
        copy.dispose();
        const backend = renderer.backend as unknown as {
            get(a: unknown): { buffer?: unknown };
            destroyAttribute(a: unknown): void;
        };
        for (const attribute of attributes)
            if (backend.get(attribute).buffer) backend.destroyAttribute(attribute);
    }
}
