import {
    DirectionalLight,
    AmbientLight,
    Mesh,
    MeshStandardNodeMaterial,
    PlaneGeometry,
    OrthographicCamera,
    RenderTarget,
    Scene,
    FloatType,
    PCFShadowMap,
    type WebGPURenderer,
} from 'three/webgpu';
import { createTerrain } from '../../../packages/three/src/runtime/three';
import { createTerrainBinding } from '../../../packages/three/src/runtime/binding';
import { createFlatTopology } from '../../../packages/three/src/quadtree/topology/flat';
import type { GymResult } from '../../../packages/three/gym/report';

/** Separate finite fixture for Three's actual shadow override and receiving path. */
export async function measureShadowIntegration(renderer: WebGPURenderer, result: GymResult) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    const scene = new Scene(),
        target = new RenderTarget(32, 32, { type: FloatType });
    const terrain = createTerrain({
        renderer,
        topology: createFlatTopology({ rootSize: 16, origin: { x: 0, y: 0, z: 0 } }),
        maxNodes: 64,
        maxLevel: 3,
        innerTileSegments: 13,
        skirtScale: 0,
        queries: { readback: 'disabled' },
    });
    const binding = createTerrainBinding(terrain);
    scene.add(binding.mesh);
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(0, 30, 0);
    light.castShadow = true;
    light.shadow.camera.left = light.shadow.camera.bottom = -24;
    light.shadow.camera.right = light.shadow.camera.top = 24;
    light.shadow.camera.far = 100;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.0001;
    light.shadow.camera.layers.enable(1);
    scene.add(light, light.target, new AmbientLight(0xffffff, 0.2));
    const planeMaterial = new MeshStandardNodeMaterial(),
        plane = new Mesh(new PlaneGeometry(48, 48), planeMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -2;
    plane.receiveShadow = true;
    scene.add(plane);
    const camera = new OrthographicCamera(-16, 16, 16, -16, 0.1, 100);
    camera.position.set(0, 25, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const brightness = async () => {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const values = new Float32Array(
            (await renderer.readRenderTargetPixelsAsync(target, 0, 0, 32, 32)).buffer
        );
        return values[(16 * 32 + 16) * 4]!;
    };
    try {
        const update = await terrain.update(binding.viewFromCamera(camera, 32));
        if (update.status === 'error') throw update.error;
        // Terrain is visible only to the light camera; compare its shadow on a receiver.
        binding.mesh.layers.set(1);
        const lit = await brightness();
        binding.mesh.castShadow = true;
        const cast = await brightness();
        result.assertions.push({
            name: 'terrain casts through Three shadow override',
            checkpoint: 'shadow',
            actual: { lit, cast },
            expected: 'finite shadow below 80% of lit receiver',
            pass: Number.isFinite(cast) && lit > 0.05 && cast < lit * 0.8,
        });
        // Swap roles: ordinary geometry in the light layer, terrain receives in main.
        binding.mesh.layers.set(0);
        binding.mesh.castShadow = false;
        binding.mesh.receiveShadow = true;
        plane.layers.set(1);
        plane.position.y = 2;
        plane.receiveShadow = false;
        plane.geometry.dispose();
        plane.geometry = new PlaneGeometry(8, 8);
        const terrainLit = await brightness();
        plane.castShadow = true;
        const received = await brightness();
        result.assertions.push({
            name: 'terrain receives ordinary geometry shadow',
            checkpoint: 'shadow',
            actual: { lit: terrainLit, received },
            expected: 'finite shadow below 80% of lit terrain',
            pass: Number.isFinite(received) && terrainLit > 0.05 && received < terrainLit * 0.8,
        });
    } finally {
        renderer.setRenderTarget(null);
        await binding.dispose();
        await terrain.dispose();
        plane.geometry.dispose();
        planeMaterial.dispose();
        target.dispose();
        light.shadow.dispose();
    }
}
