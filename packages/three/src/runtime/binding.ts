import { mat4, mat3, vec3, type Vec3, type Mat4 } from 'math';
import type { Camera, Vector3 } from 'three';
import { MeshStandardNodeMaterial, type NodeMaterial } from 'three/webgpu';
import { TerrainMesh } from '../mesh/TerrainMesh';
import type { Terrain } from './three';
import type {
    TerrainSampleResult,
    TerrainView,
    TerrainRaycastOptions,
    TerrainRaycastSample,
} from './runtime';
import { Vector3 as ThreeVector3 } from 'three';

/** Scene placement and material attachment are owned by this explicit adapter. */
export function createTerrainBinding(terrain: Terrain, options: {
    material?: NodeMaterial;
    /** Adapter-owned child materials (R3F) still receive publication synchronously. */
    externalMaterialAttachment?: boolean;
} = {}) {
    if (terrain.getStatus().lifecycle === 'disposing' || terrain.getStatus().lifecycle === 'disposed')
        throw new Error('Cannot bind a disposed terrain');
    const material = options.material ?? new MeshStandardNodeMaterial();
    const ownershipKey = 'helloTerrainPositionOwner',
        owner = {};
    if (material.positionNode || material.userData[ownershipKey])
        throw new Error('Terrain binding requires ownership of material.positionNode');
    material.userData[ownershipKey] = owner;
    const original = material.positionNode;
    let installed: NodeMaterial['positionNode'] = original;
    const config = terrain.getConfig();
    const mesh = new TerrainMesh({
        material,
        maxNodes: config.maxNodes,
        innerTileSegments: config.innerTileSegments,
        flipWinding: config.topology.projection.faceOutward,
        retireResource: (resource) => {
            void terrain.retireBindingResource(resource);
        },
    });
    mesh.count = 0;
    let disposed = false;
    const matrix = mat4.create(),
        inverse = mat4.create(),
        normal = mat3.create();
    const local: Vec3 = vec3.create();
    function transforms() {
        mesh.updateWorldMatrix(true, false);
        for (let i = 0; i < 16; i++) matrix[i] = mesh.matrixWorld.elements[i]!;
        if (!mat4.invert(inverse, matrix) || !mat3.normalFromMat4(normal, matrix))
            throw new Error('Terrain binding has a singular transform');
    }
    function worldSample(value: TerrainSampleResult): TerrainSampleResult {
        if (value.status !== 'available') return value;
        return {
            ...value,
            position: vec3.transformMat4(vec3.create(), value.position, matrix),
            normal: vec3.normalize(
                vec3.create(),
                vec3.transformMat3(vec3.create(), value.normal, normal)
            ),
        };
    }
    function sync() {
        if (disposed) return;
        if (
            terrain.getStatus().lifecycle === 'disposing' ||
            terrain.getStatus().lifecycle === 'disposed'
        ) {
            mesh.count = 0;
            return;
        }
        const render = terrain.getRender();
        if (!render) return;
        // R3F installs its child material on the mesh. Update the actual draw
        // material before retiring the previous publication, without waiting
        // for React's asynchronous render/commit of the render-prop node.
        if (options.externalMaterialAttachment && mesh.material !== material) {
            const attached = mesh.material as NodeMaterial;
            if (attached.positionNode !== render.positionNode) {
                attached.positionNode = render.positionNode;
                attached.needsUpdate = true;
            }
        }
        mesh.maxNodes = render.config.maxNodes;
        mesh.innerTileSegments = render.config.innerTileSegments;
        mesh.flipWinding = render.config.topology.projection.faceOutward;
        mesh.count = render.count;
        if (installed !== render.positionNode) {
            if (material.positionNode !== installed)
                throw new Error('Terrain material position attachment was replaced while bound');
            installed = render.positionNode;
            material.positionNode = installed;
            material.needsUpdate = true;
        }
    }
    function raycastWorld(
        origin: Vec3,
        direction: Vec3,
        options: TerrainRaycastOptions = {}
    ): TerrainRaycastSample {
        transforms();
        const localOrigin = vec3.transformMat4(vec3.create(), origin, inverse);
        const localDirection: Vec3 = [
            inverse[0] * direction[0] + inverse[4] * direction[1] + inverse[8] * direction[2],
            inverse[1] * direction[0] + inverse[5] * direction[1] + inverse[9] * direction[2],
            inverse[2] * direction[0] + inverse[6] * direction[1] + inverse[10] * direction[2],
        ];
        const scale = vec3.length(localDirection);
        vec3.normalize(localDirection, localDirection);
        const hit = terrain.query.raycast(localOrigin, localDirection, {
            ...options,
            near: (options.near ?? 0) * scale,
            far: (options.far ?? 10000) * scale,
            tolerance: (options.tolerance ?? 0.001) * scale,
        });
        if (hit.status !== 'hit') return hit;
        const sample = worldSample(hit.sample) as typeof hit.sample;
        return { ...hit, sample, distance: vec3.distance(origin, sample.position) };
    }
    mesh.raycast = (raycaster, intersects) => {
        const hit = raycastWorld(raycaster.ray.origin.toArray(), raycaster.ray.direction.toArray(), {
            near: raycaster.near,
            far: Number.isFinite(raycaster.far) ? raycaster.far : 10000,
        });
        if (hit.status === 'hit')
            intersects.push({
                object: mesh,
                distance: hit.distance,
                point: new ThreeVector3().fromArray(hit.sample.position),
                normal: new ThreeVector3().fromArray(hit.sample.normal),
                face: null,
                faceIndex: -1,
            });
    };
    const unsubscribe = terrain.subscribe(sync);
    sync();
    return {
        mesh,
        material,
        terrain,
        raycastWorld,
        viewFromCamera(camera: Camera, viewportHeight: number): TerrainView {
            transforms();
            camera.updateWorldMatrix(true, false);
            const e = camera.matrixWorld.elements;
            vec3.transformMat4(local, [e[12]!, e[13]!, e[14]!], inverse);
            const projectionFactor =
                (viewportHeight * Math.abs(camera.projectionMatrix.elements[5]!)) / 2;
            return { position: vec3.clone(local), projectionFactor };
        },
        sampleWorld(position: Vec3 | Vector3, request?: { minEditVersion?: number }) {
            transforms();
            const point: Vec3 = Array.isArray(position)
                ? position
                : [position.x, position.y, position.z];
            vec3.transformMat4(local, point, inverse);
            return worldSample(terrain.query.sample(local, request));
        },
        acquireSnapshot() {
            transforms();
            const lease = terrain.query.acquireSnapshot();
            if (!lease) return null;
            // Pin placement as well as CPU data for physics steps.
            const capturedMatrix = [...matrix] as Mat4,
                capturedInverse = [...inverse] as Mat4;
            const capturedNormal = mat3.clone(normal);
            return {
                revision: lease.revision,
                sampleWorld(position: Vec3): TerrainSampleResult {
                    const value = lease.sample(
                        vec3.transformMat4(vec3.create(), position, capturedInverse)
                    );
                    if (value.status !== 'available') return value;
                    return {
                        ...value,
                        position: vec3.transformMat4(vec3.create(), value.position, capturedMatrix),
                        normal: vec3.normalize(
                            vec3.create(),
                            vec3.transformMat3(vec3.create(), value.normal, capturedNormal)
                        ),
                    };
                },
                release: lease.release,
            };
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            if (material.positionNode === installed) {
                material.positionNode = original;
                material.needsUpdate = true;
            }
            if (material.userData[ownershipKey] === owner) delete material.userData[ownershipKey];
            mesh.removeFromParent();
            await terrain.settle();
            mesh.geometry.dispose();
            mesh.dispose();
            if (!options.material) material.dispose();
        },
    };
}

export type TerrainBinding = ReturnType<typeof createTerrainBinding>;
