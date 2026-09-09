'use client';

import { ExamplesCanvas } from '@/components/ExamplesCanvas';
import { FpsDebug } from '@/components/FpsDebug';
import { RunTimingBars } from '@/components/RunTimingBars';
import { TerrainTileDebug } from '@/components/TerrainTileDebug';
import {
    createInfiniteFlatTopology,
    voronoiCells,
    type ElevationCallback,
    type TerrainGraph,
} from '@hello-terrain/three';
import { Terrain, useTerrain } from '@hello-terrain/react';
import { Environment, OrbitControls } from '@react-three/drei';
import { Canvas, extend } from '@react-three/fiber';
import { useControls, useCreateStore } from 'leva';

type LevaStore = ReturnType<typeof useCreateStore>;
import { useEffect, useMemo, useState } from 'react';
import {
    resolveTerrainMaterialAppearance,
    tileColorsLevaControl,
} from '@/examples/terrain/tileInstanceColor';
import type { WebGPURendererParameters } from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { float, Fn, positionWorld, vec2, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';

extend(THREE as any);

type InfiniteFlatSceneImplProps = {
    onGraphReady: (graph: TerrainGraph) => void;
    store: LevaStore;
};

const terrainPatternColorNode = Fn(() => {
    const worldUv = vec2(positionWorld.x, positionWorld.z);
    const tint = vec3(0.45, 0.55, 0.3);
    const pattern = worldUv.mul(0.1).sin().mul(0.5).add(0.5);
    return tint.mul(pattern.x.add(pattern.y).mul(0.5).add(0.5));
})();

const InfiniteFlatSceneImpl = ({ onGraphReady, store }: InfiniteFlatSceneImplProps) => {
    const controls = useControls(
        'Infinite Flat Terrain',
        {
            rootSize: {
                value: 128,
                min: 16,
                max: 4096,
                step: 16,
                label: 'root size',
            },
            maxLevel: {
                value: 12,
                min: 2,
                max: 24,
                step: 2,
                label: 'max level',
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
            elevationScale: {
                value: 1,
                min: 0,
                max: 1000,
                step: 1,
                label: 'elevation scale',
            },
            rootGridRadius: {
                value: 1,
                min: 1,
                max: 4,
                step: 1,
                label: 'root grid radius',
            },
            wireframe: {
                value: false,
                label: 'wireframe',
            },
            tileColors: tileColorsLevaControl,
        },
        { store }
    );

    const topology = useMemo(
        () =>
            createInfiniteFlatTopology({
                rootSize: controls.rootSize,
                origin: { x: 0, y: 0, z: 0 },
                rootGridRadius: controls.rootGridRadius,
            }),
        [controls.rootSize, controls.rootGridRadius]
    );
    const elevation = useMemo<ElevationCallback>(
        () =>
            ({ worldPosition }) =>
                voronoiCells({
                    scale: float(1),
                    facet: 0,
                    seed: 0,
                    uv: vec2(worldPosition.x, worldPosition.z).mul(0.5),
                }).mul(0.5),
        []
    );
    const terrain = useTerrain({
        topology,
        elevation,
        elevationRange: { min: 0, max: 0.5 },
        maxNodes: controls.maxNodes,
        maxLevel: controls.maxLevel,
        skirtScale: controls.skirtScale,
        elevationScale: controls.elevationScale,
    });
    useEffect(() => onGraphReady(terrain.graph), [onGraphReady, terrain.graph]);

    const materialAppearance = resolveTerrainMaterialAppearance({
        tileColors: controls.tileColors,
        wireframe: controls.wireframe,
        colorNode: terrainPatternColorNode,
    });

    return (
        <>
            <Environment preset="sunset" />
            <Terrain terrain={terrain}>
                {({ positionNode }) => (
                    <meshStandardNodeMaterial
                        positionNode={positionNode}
                        wireframe={materialAppearance.wireframe}
                        metalness={0.1}
                        colorNode={materialAppearance.colorNode}
                        color={materialAppearance.color}
                    />
                )}
            </Terrain>
        </>
    );
};

const InfiniteFlatScene = () => {
    const store = useCreateStore();
    const [g, setGraph] = useState<TerrainGraph | null>(null);

    return (
        <ExamplesCanvas store={store}>
            <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
                {g && <RunTimingBars graph={g} />}
                <div className="flex flex-row gap-1.5">
                    {g && <TerrainTileDebug graph={g} />}
                    <FpsDebug />
                </div>
            </div>
            <Canvas
                className="touch-none relative w-full h-full top-0 left-0"
                shadows
                gl={async (props) => {
                    props.alpha = true;
                    props.antialias = true;
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
                    position: [0, 50, 80],
                }}
                dpr={[1, 1]}
                performance={{ min: 0.5 }}
            >
                <ambientLight intensity={0.15} />
                <directionalLight intensity={1} position={[1, 1, 1]} />
                <InfiniteFlatSceneImpl onGraphReady={setGraph} store={store} />
                <OrbitControls makeDefault />
            </Canvas>
        </ExamplesCanvas>
    );
};

export default InfiniteFlatScene;
