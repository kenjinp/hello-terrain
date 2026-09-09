'use client';

import { ExamplesCanvas } from '@/components/ExamplesCanvas';
import {
    createTerrain,
    createTerrainBinding,
    createFlatTopology,
    type TerrainBinding,
} from '@hello-terrain/three';
import { Bounds, OrbitControls } from '@react-three/drei';
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber';
import { useControls, useCreateStore } from 'leva';

type LevaStore = ReturnType<typeof useCreateStore>;
import {
    resolveTerrainMaterialAppearance,
    tileColorsLevaControl,
} from '@/examples/terrain/tileInstanceColor';
import { useEffect, useState } from 'react';
import type { WebGPURendererParameters } from 'three/src/renderers/webgpu/WebGPURenderer.js';
import * as THREE from 'three/webgpu';

extend(THREE as any);

type TerrainMeshSceneImplProps = {
    store: LevaStore;
};

const TerrainMeshSceneImpl = ({ store }: TerrainMeshSceneImplProps) => {
    const controls = useControls(
        'TerrainGeometry',
        {
            rootSize: {
                value: 128,
                min: 2,
                max: 4092 * 2,
                step: 2,
                label: 'root size',
            },
            maxLevel: {
                value: 12,
                min: 2,
                max: 24,
                step: 2,
                label: 'max level',
            },
            innerTileSegments: {
                value: 14,
                min: 2,
                max: 64,
                step: 2,
                label: 'inner segments',
            },
            maxNodes: {
                value: 1028,
                min: 128,
                max: 2048,
                step: 1,
                label: 'max nodes',
            },
            skirtScale: {
                value: 10,
                min: 0,
                max: 1000,
                step: 1,
                label: 'skirt scale',
            },
            tileColors: { ...tileColorsLevaControl, value: true },
        },
        { store }
    );

    const renderer = useThree((state) => state.gl) as unknown as THREE.WebGPURenderer;
    const [binding, setBinding] = useState<TerrainBinding | null>(null);
    // Vanilla ownership, hosted in a React effect solely to attach the scene object.
    useEffect(() => {
        const terrain = createTerrain({ renderer });
        const binding = createTerrainBinding(terrain);
        setBinding(binding);
        return () => {
            void (async () => {
                await binding.dispose();
                await terrain.dispose();
            })();
        };
    }, [renderer]);
    useEffect(() => {
        if (!binding) return;
        binding.terrain.configure({
            topology: createFlatTopology({
                rootSize: controls.rootSize,
                origin: { x: 0, y: 0, z: 0 },
            }),
            innerTileSegments: controls.innerTileSegments,
            maxNodes: controls.maxNodes,
            maxLevel: controls.maxLevel,
            skirtScale: controls.skirtScale,
        });
        const appearance = resolveTerrainMaterialAppearance({
            tileColors: controls.tileColors,
            wireframe: true,
        });
        const material = binding.material as THREE.MeshStandardNodeMaterial;
        material.colorNode = appearance.colorNode ?? null;
        material.wireframe = appearance.wireframe;
        if (appearance.color) material.color.set(appearance.color);
        material.needsUpdate = true;
    }, [
        binding,
        controls.rootSize,
        controls.innerTileSegments,
        controls.maxNodes,
        controls.maxLevel,
        controls.skirtScale,
        controls.tileColors,
    ]);
    useFrame(({ camera, size }) => {
        if (binding && !binding.terrain.getStatus().productionPending) {
            void binding.terrain.update(binding.viewFromCamera(camera, size.height));
        }
    });
    return binding ? <primitive object={binding.mesh} /> : null;
};

const TerrainMeshScene = () => {
    const store = useCreateStore();

    return (
        <ExamplesCanvas store={store}>
            <Canvas
                className="touch-none relative w-full h-full top-0 left-0"
                shadows
                gl={async (props) => {
                    props.alpha = true;
                    props.antialias = true;
                    // soft shadows
                    const renderer = new THREE.WebGPURenderer(props as WebGPURendererParameters);

                    renderer.logarithmicDepthBuffer = true;
                    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
                    renderer.shadowMap.enabled = true;

                    await renderer.init();
                    return renderer;
                }}
                camera={{
                    near: 0.001,
                    far: Number.MAX_SAFE_INTEGER,
                    position: [0, 3, 1],
                }}
                dpr={[1, 1]}
                performance={{ min: 0.5 }}
            >
                <ambientLight intensity={0.15} />
                <directionalLight intensity={1} position={[1, 1, 1]} />
                <Bounds fit observe>
                    <TerrainMeshSceneImpl store={store} />
                </Bounds>
                <OrbitControls makeDefault />
            </Canvas>
        </ExamplesCanvas>
    );
};

export default TerrainMeshScene;
