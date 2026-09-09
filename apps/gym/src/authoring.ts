import {
    DataTexture,
    FloatType,
    MeshStandardNodeMaterial,
    NearestFilter,
    NoToneMapping,
    OrthographicCamera,
    RenderTarget,
    Scene,
    WebGPURenderer,
} from 'three/webgpu';
import { float, mix, vec2, vec3, vec4, transformedNormalWorld } from 'three/tsl';
import { createTerrain } from '../../../packages/three/src/runtime/three';
import { terrainTasks } from '../../../packages/three/src/tasks/graph';
import { createTerrainBinding } from '../../../packages/three/src/runtime/binding';
import { createManagedTerrainTexture } from '../../../packages/three/src/tsl/managedTexture';
import { bindTerrainSource } from '../../../packages/three/src/runtime/source';
import {
    createSourceMapping,
    terrainDetailNormal,
    terrainWeights,
} from '../../../packages/three/src/tsl/terrainMaterial';
import { createFlatTopology } from '../../../packages/three/src/quadtree/topology/flat';
import { numericAssertion } from '../../../packages/three/gym/oracles';
import type { GymResult } from '../../../packages/three/gym/report';

export async function runAuthoring(capabilities: GymResult['capabilities']): Promise<GymResult> {
    const renderer = new WebGPURenderer();
    await renderer.init();
    renderer.toneMapping = NoToneMapping;
    const result: GymResult = {
        status: 'passed',
        assertions: [],
        metrics: {},
        samples: [],
        capabilities,
    };
    const map = new DataTexture(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    map.minFilter = map.magFilter = NearestFilter;
    map.needsUpdate = true;
    const source = createManagedTerrainTexture(map);
    const replacements: DataTexture[] = [];
    const scene = new Scene(),
        target = new RenderTarget(32, 16, { type: FloatType });
    const camera = new OrthographicCamera(-20, 20, 10, -10, 0.1, 100);
    camera.position.set(0, 30, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const terrains = [0, 1].map(() =>
        createTerrain({
            renderer,
            topology: createFlatTopology({ rootSize: 16, origin: { x: 0, y: 0, z: 0 } }),
            elevation: () => float(2),
            elevationRange: { min: 2, max: 2 },
            innerTileSegments: 13,
            maxNodes: 64,
            maxLevel: 3,
            skirtScale: 0,
        })
    );
    const materials = terrains.map(() => new MeshStandardNodeMaterial());
    const bindings = terrains.map((terrain, i) =>
        createTerrainBinding(terrain, { material: materials[i] })
    );
    const detach = terrains.map((terrain) => bindTerrainSource(terrain, source, ['appearance']));
    let geometryRuns = 0;
    const unsubscribe = terrains.map((terrain) =>
        terrain.onGraphEvent((event) => {
            if (event.type === 'task:finish' && event.taskId === terrainTasks.executeCompute.id)
                geometryRuns++;
        })
    );
    try {
        for (const [i, binding] of bindings.entries()) {
            binding.mesh.position.x = i ? 10 : -10;
            scene.add(binding.mesh);
            const update = await terrains[i]!.update(binding.viewFromCamera(camera, 16));
            if (update.status === 'error') throw update.error;
            const ctx = terrains[i]!.getRender()!.materialContext;
            const mapping = createSourceMapping({ scale: [0.5, 1], offset: [i * 0.5, 0] });
            const uv = mapping.uv(ctx.sourceUV),
                weights = source.sample(uv);
            const [grass, rock, snow] = terrainWeights([weights.r, weights.g, weights.b]);
            const painted = vec3(0, 1, 0)
                .mul(grass!)
                .add(vec3(1, 0, 0).mul(rock!))
                .add(vec3(1).mul(snow!));
            const procedural = ctx.elevation.smoothstep(3, 5).max(ctx.slopeCosine.oneMinus());
            materials[i]!.outputNode = vec4(mix(painted, vec3(1), procedural), 1);
            materials[i]!.normalNode = terrainDetailNormal(ctx, vec3(0.5, 0.5, 1), uv);
            materials[i]!.needsUpdate = true;
        }
        const pixels = async () => {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
            return new Float32Array(
                (await renderer.readRenderTargetPixelsAsync(target, 0, 0, 32, 16)).buffer
            );
        };
        const initial = await pixels();
        const left = (8 * 32 + 8) * 4,
            right = (8 * 32 + 24) * 4;
        result.assertions.push(
            numericAssertion(
                'shared map independent left mapping',
                'initial',
                initial[left + 1]!,
                1,
                0.001
            )
        );
        result.assertions.push(
            numericAssertion(
                'shared map independent right mapping',
                'initial',
                initial[right]!,
                1,
                0.001
            )
        );
        const versions = terrains.map((t) => t.getStatus().renderRevision!.productionVersion);
        const queries = terrains.map((t) => t.getStatus().queryRevision!.productionVersion);
        const beforeRuns = geometryRuns;
        const edit = await source.edit((texture) => {
            (texture.image as { data: Uint8Array }).data.set([0, 0, 255, 255], 0);
            texture.needsUpdate = true;
        });
        await edit.retired;
        for (const [i, terrain] of terrains.entries())
            await terrain.update(bindings[i]!.viewFromCamera(camera, 16));
        const painted = await pixels();
        result.assertions.push(
            numericAssertion(
                'appearance paint reaches fragment sampling',
                'paint',
                painted[left]!,
                1,
                0.001
            )
        );
        result.assertions.push(
            numericAssertion(
                'appearance paint performs no geometry compute',
                'paint',
                geometryRuns - beforeRuns,
                0,
                0
            )
        );
        terrains.forEach((terrain, i) => {
            result.assertions.push(
                numericAssertion(
                    `terrain ${i} geometry revision unchanged`,
                    'paint',
                    terrain.getStatus().renderRevision!.productionVersion,
                    versions[i]!,
                    0
                )
            );
            result.assertions.push(
                numericAssertion(
                    `terrain ${i} query revision unchanged`,
                    'paint',
                    terrain.getStatus().queryRevision!.productionVersion,
                    queries[i]!,
                    0
                )
            );
            result.assertions.push({
                checkpoint: 'paint',
                name: `terrain ${i} material identity`,
                pass: bindings[i]!.mesh.material === materials[i],
                actual: bindings[i]!.mesh.material === materials[i],
                expected: true,
            });
        });
        // A tilted tangent-space detail normal must preserve and compose with the
        // terrain base normal. Flipping the mapping flips the corresponding tangent.
        const ctx = terrains[0]!.getRender()!.materialContext;
        materials[0]!.normalNode = terrainDetailNormal(ctx, vec3(0.8, 0.5, 0.9), ctx.sourceUV);
        materials[0]!.outputNode = vec4(transformedNormalWorld, 1);
        materials[0]!.needsUpdate = true;
        const detail = await pixels();
        result.assertions.push(
            numericAssertion('mapped detail normal world X', 'detail', detail[left]!, 0.6, 0.01)
        );
        result.assertions.push(
            numericAssertion('mapped detail normal base Y', 'detail', detail[left + 1]!, 0.8, 0.01)
        );
        const replacement = new DataTexture(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), 2, 1);
        replacement.minFilter = replacement.magFilter = NearestFilter;
        replacement.needsUpdate = true;
        replacements.push(replacement);
        let disposedBySource = false;
        map.addEventListener('dispose', () => {
            disposedBySource = true;
        });
        const replaced = await source.replace(replacement);
        await replaced.retired;
        const replacedPixels = await pixels();
        result.assertions.push(
            numericAssertion(
                'compatible replacement updates existing sampler',
                'replace',
                replacedPixels[right + 1]!,
                1,
                0.001
            )
        );
        result.assertions.push({
            checkpoint: 'replace',
            name: 'borrowed texture not disposed',
            pass: !disposedBySource,
            actual: disposedBySource,
            expected: false,
        });
        const initialContext = terrains[0]!.getRender()!.materialContext;
        detach.push(bindTerrainSource(terrains[0]!, source, ['elevation']));
        terrains[0]!.configure({
            elevation: () => source.sample(vec2(0.75, 0.5), 'compute').b.mul(4),
            elevationRange: { min: 0, max: 4 },
        });
        await terrains[0]!.update(bindings[0]!.viewFromCamera(camera, 16));
        const beforeSharedEdit = terrains[1]!.getStatus().renderRevision!.productionVersion;
        const sharedEdit = await source.edit((texture) => {
            (texture.image as { data: Uint8Array }).data.set([0, 255, 0, 255], 4);
            texture.needsUpdate = true;
        });
        await sharedEdit.retired;
        await terrains[0]!.requestSnapshot({
            minEditVersion: terrains[0]!.getStatus().acceptedEditVersion,
        });
        const ground = terrains[0]!.query.sample([0, 0, 0]);
        result.assertions.push(
            numericAssertion(
                'shared map refreshes declared elevation and CPU query',
                'shared-edit',
                ground.status === 'available' ? ground.elevation : null,
                0,
                0.001
            )
        );
        result.assertions.push(
            numericAssertion(
                'appearance-only peer reuses geometry',
                'shared-edit',
                terrains[1]!.getStatus().renderRevision!.productionVersion,
                beforeSharedEdit,
                0
            )
        );
        result.assertions.push({
            checkpoint: 'shared-edit',
            name: 'material context identity survives source rebuild',
            pass: terrains[0]!.getRender()!.materialContext === initialContext,
            actual: terrains[0]!.getRender()!.materialContext === initialContext,
            expected: true,
        });
        const geometry = bindings[0]!.mesh.geometry;
        let geometryRetired = false;
        geometry.addEventListener('dispose', () => {
            geometryRetired = true;
        });
        terrains[0]!.configure({ maxNodes: 128, innerTileSegments: 17 });
        const resized = await terrains[0]!.update(bindings[0]!.viewFromCamera(camera, 16));
        if (resized.status === 'error') throw resized.error;
        await terrains[0]!.settle();
        await pixels();
        result.assertions.push({
            checkpoint: 'resize',
            name: 'old binding geometry retired after submission',
            actual: geometryRetired,
            expected: true,
            pass: geometryRetired,
        });
        result.assertions.push({
            checkpoint: 'resize',
            name: 'capacity and field resolution update without material replacement',
            actual: bindings[0]!.mesh.material === materials[0],
            expected: true,
            pass:
                bindings[0]!.mesh.material === materials[0] &&
                bindings[0]!.mesh.innerTileSegments === 17 &&
                bindings[0]!.mesh.maxNodes === 128,
        });
        result.status = result.assertions.every((a) => a.pass) ? 'passed' : 'failed';
        result.metrics.geometryRuns = geometryRuns;
        return result;
    } finally {
        detach.forEach((fn) => fn());
        unsubscribe.forEach((fn) => fn());
        source.releaseSamplers();
        renderer.setRenderTarget(null);
        for (const binding of bindings) await binding.dispose();
        for (const terrain of terrains) await terrain.dispose();
        materials.forEach((material) => material.dispose());
        map.dispose();
        replacements.forEach((texture) => texture.dispose());
        target.dispose();
        renderer.dispose();
    }
}
