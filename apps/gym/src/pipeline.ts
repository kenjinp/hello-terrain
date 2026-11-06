import { MeshBasicNodeMaterial, NoToneMapping, PerspectiveCamera, RenderTarget, Scene, WebGPURenderer } from 'three/webgpu';
import { normalWorld, vec4 } from 'three/tsl';
import { createTerrain } from '../../../packages/three/src/runtime/three';
import { createTerrainBinding } from '../../../packages/three/src/runtime/binding';
import { createFlatTopology } from '../../../packages/three/src/quadtree/topology/flat';
import { terrainTasks } from '../../../packages/three/src/tasks/graph';
import type { ElevationCallback } from '../../../packages/three/src/tsl/elevation';

export interface PipelineOptions {
    segments?: 13 | 61;
    width?: number;
    height?: number;
    warmup?: number;
    samples?: number;
}

/** A timestamp envelope, not the sum of isolated pass durations.
 * Each render pass gets a distinct query; resolve the last actual render end.
 * Wrappers exist only during one serialized sample and are always restored.
 */
function timestampEnvelope(device: GPUDevice) {
    const supported = device.features.has('timestamp-query');
    const queries = supported ? device.createQuerySet({ type: 'timestamp', count: 64 }) : null;
    const resolve = supported ? device.createBuffer({ size: 512, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
    const read = supported ? device.createBuffer({ size: 512, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
    const original = device.createCommandEncoder;
    let computePasses = 0, renderPasses = 0, finalRender = false;
    device.createCommandEncoder = function (descriptor) {
        const encoder = original.call(device, descriptor);
        const compute = encoder.beginComputePass.bind(encoder);
        const render = encoder.beginRenderPass.bind(encoder);
        encoder.beginComputePass = (descriptor = {}) => {
            computePasses++;
            if (!queries || computePasses !== 1) return compute(descriptor);
            if (descriptor.timestampWrites) throw new Error('Conflicting compute timestamp instrumentation');
            return compute({ ...descriptor, timestampWrites: { querySet: queries, beginningOfPassWriteIndex: 0 } });
        };
        encoder.beginRenderPass = (descriptor) => {
            if (!finalRender) return render(descriptor);
            renderPasses++;
            if (!queries) return render(descriptor);
            if (renderPasses >= 64) throw new Error('Render timestamp query capacity exceeded');
            if (descriptor.timestampWrites) throw new Error('Conflicting render timestamp instrumentation');
            return render({ ...descriptor, timestampWrites: { querySet: queries, endOfPassWriteIndex: renderPasses } });
        };
        return encoder;
    };
    return {
        startRender() { finalRender = true; },
        restore() { device.createCommandEncoder = original; },
        async result() {
            if (!queries || !resolve || !read || !computePasses || !renderPasses)
                return { gpuEnvelopeMs: null, computePasses, renderPasses, timestampSupported: supported };
            // Diagnostic query transfer happens after the wall timer stops.
            const encoder = original.call(device);
            encoder.resolveQuerySet(queries, 0, renderPasses + 1, resolve, 0);
            encoder.copyBufferToBuffer(resolve, 0, read, 0, 512);
            device.queue.submit([encoder.finish()]);
            await read.mapAsync(GPUMapMode.READ);
            const times = new BigUint64Array(read.getMappedRange());
            const gpuEnvelopeMs = Number(times[renderPasses]! - times[0]!) / 1e6;
            read.unmap();
            return { gpuEnvelopeMs, computePasses, renderPasses, timestampSupported: supported };
        },
        dispose() { queries?.destroy(); resolve?.destroy(); read?.destroy(); },
    };
}

function checksum(values: ArrayBufferView) {
    let hash = 2166136261;
    for (const byte of new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
        hash = Math.imul(hash ^ byte, 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function runPipelineBench(options: PipelineOptions = {}) {
    const config = { segments: options.segments ?? 61, width: options.width ?? 640,
        height: options.height ?? 480, warmup: options.warmup ?? 4, samples: options.samples ?? 20 };
    if (![13, 61].includes(config.segments) || ![config.width, config.height, config.samples].every(v => Number.isInteger(v) && v > 0)
        || !Number.isInteger(config.warmup) || config.warmup < 0) throw new Error('Invalid pipeline benchmark options');
    const setupBegin = performance.now();
    const renderer = new WebGPURenderer({ antialias: false });
    await renderer.init();
    renderer.toneMapping = NoToneMapping;
    renderer.setSize(config.width, config.height);
    const device = (renderer.backend as unknown as { device: GPUDevice }).device;
    const errors: string[] = [];
    const onError = (event: GPUUncapturedErrorEvent) => errors.push(event.error.message);
    device.addEventListener('uncapturederror', onError);
    const target = new RenderTarget(config.width, config.height);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x18202a, 1);
    const scene = new Scene();
    const camera = new PerspectiveCamera(55, config.width / config.height, 0.1, 5000);
    const elevation = (offset: number): ElevationCallback => ({ worldPosition }) =>
        worldPosition.x.mul(0.03).add(worldPosition.z.mul(0.02)).add(offset);
    const fields = [elevation(2), elevation(5)];
    const terrain = createTerrain({ renderer,
        topology: createFlatTopology({ rootSize: 1024, origin: { x: 0, y: 0, z: 0 } }),
        elevation: fields[0], elevationRange: { min: -24, max: 32 },
        innerTileSegments: config.segments, maxNodes: 1024, maxLevel: 8, skirtScale: 20,
        lod: { mode: 'distance', distanceFactor: 1.5 },
        // Preserve production defaults: on-change CPU readback, linear rgba16float field.
    });
    const material = new MeshBasicNodeMaterial();
    material.outputNode = vec4(normalWorld.mul(0.5).add(0.5), 1);
    const binding = createTerrainBinding(terrain, { material });
    scene.add(binding.mesh);
    const samples: Record<string, unknown>[] = [];
    const failures: string[] = [];
    let previousLayout = '', offset = 2;
    function pose(near: boolean) {
        camera.position.set(near ? 64 : -64, near ? 60 : 1100, near ? 96 : 1200);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
    }
    async function measure(kind: 'cold' | 'lod' | 'edit', iteration: number, phase: 'cold' | 'warmup' | 'measured') {
        await device.queue.onSubmittedWorkDone();
        const before = terrain.getStatus();
        const envelope = timestampEnvelope(device);
        let wallMs: number, updateMs: number;
        try {
            const start = performance.now();
            if (kind === 'edit') {
                const index = iteration % 2;
                offset = index ? 5 : 2;
                terrain.configure({ elevation: fields[index] });
            } else pose(kind === 'cold' || iteration % 2 === 1);
            const update = await terrain.update(binding.viewFromCamera(camera, config.height));
            if (update.status === 'error') throw update.error;
            updateMs = performance.now() - start;
            envelope.startRender();
            await renderer.renderAsync(scene, camera);
            await device.queue.onSubmittedWorkDone();
            wallMs = performance.now() - start;
            envelope.restore();
            const timing = await envelope.result();
            const status = terrain.getStatus();
            const render = terrain.getRender();
            const leaves = render?.graph.peek(terrainTasks.quadtreeUpdate);
            if (!render || !leaves) throw new Error('No published geometry');
            const tiles = Array.from({ length: leaves.count }, (_, i) => ({
                space: leaves.space[i], level: leaves.level[i], x: leaves.x[i], y: leaves.y[i],
            }));
            const layout = JSON.stringify(tiles);
            const revision = status.renderRevision;
            const queryRevision = status.queryRevision;
            const changed = revision?.productionVersion !== before.renderRevision?.productionVersion;
            if (!changed || !timing.computePasses) failures.push(`${kind}/${iteration}: no actual production/compute`);
            if (kind === 'lod' && layout === previousLayout) failures.push(`lod/${iteration}: unchanged tile selection`);
            if (!revision || revision.productionVersion !== queryRevision?.productionVersion || status.readbackPending || status.productionPending)
                failures.push(`${kind}/${iteration}: stale query publication`);
            const probes = [[0, 0, 0], [64, 0, 96], [-64, 0, -96]].map(p => {
                const value = terrain.query.sample(p as [number, number, number]);
                const expected = p[0]! * 0.03 + p[2]! * 0.02 + offset;
                if (value.status !== 'available' || Math.abs(value.elevation - expected) > 0.001)
                    failures.push(`${kind}/${iteration}: analytic query mismatch`);
                return { point: p, expected, value };
            });
            const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, config.width, config.height);
            const geometry = binding.mesh.geometry;
            samples.push({ kind, iteration, phase, updateStatus: update.status, wallMs, updateMs, ...timing,
                leaves: leaves.count, tiles, layoutChanged: layout !== previousLayout,
                renderRevision: revision, queryRevision, renderedInstances: binding.mesh.count,
                geometry: { verticesPerTile: geometry.attributes.position?.count, indicesPerTile: geometry.index?.count },
                probes, pixelChecksum: checksum(pixels), pixelBytes: pixels.byteLength });
            previousLayout = layout;
        } finally {
            envelope.restore();
            await device.queue.onSubmittedWorkDone();
            envelope.dispose();
        }
    }
    try {
        await measure('cold', 0, 'cold');
        const coldSetupAndFirstResultMs = performance.now() - setupBegin;
        for (let i = 0; i < config.warmup + config.samples; i++)
            await measure('lod', i, i < config.warmup ? 'warmup' : 'measured');
        // Choose the first edit different from the current field, including after zero warmup.
        for (let i = 0; i < config.warmup + config.samples; i++)
            await measure('edit', i + 1, i < config.warmup ? 'warmup' : 'measured');
        if (errors.length) failures.push(...errors);
        return { status: failures.length ? 'failed' : 'passed', config,
            workload: { rootSize: 1024, maxNodes: 1024, maxLevel: 8, skirtScale: 20,
                readback: 'on-change', terrainFieldFormat: 'rgba16float', terrainFieldFilter: 'linear',
                material: 'geometric normal diagnostic', shape: 'flat', analytic: '0.03*x + 0.02*z + offset',
                cameraNear: [64, 60, 96], cameraFar: [-64, 1100, 1200], editOffsets: [2, 5] },
            definitions: {
                wallMs: 'Before camera/config update through awaited update (including on-change query publication), current terrain render and queue completion; excludes diagnostic timestamp/pixel readback.',
                updateMs: 'Camera/config update through awaited update, including default production CPU readback.',
                gpuEnvelopeMs: 'First actual compute pass start to final actual render pass end on device timeline, including inter-submission CPU/readback idle gaps; null if unsupported. Not sum of pass costs.',
                coldSetupAndFirstResultMs: 'Renderer/terrain setup plus cold production/render and diagnostics. Cold is not pooled with warmed samples.',
                limitations: 'Single bounded flat analytic terrain with diagnostic shading, no application UI/shadows/postprocessing. Pixel checksums are comparison evidence, not standalone fidelity proof. Timestamp instrumentation has overhead.',
            },
            coldSetupAndFirstResultMs, adapter: (() => {
                const info = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
                return info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null;
            })(),
            timestampSupported: device.features.has('timestamp-query'), failures, samples };
    } finally {
        renderer.setRenderTarget(null);
        await binding.dispose();
        await terrain.dispose();
        material.dispose();
        target.dispose();
        device.removeEventListener('uncapturederror', onError);
        renderer.dispose();
    }
}
