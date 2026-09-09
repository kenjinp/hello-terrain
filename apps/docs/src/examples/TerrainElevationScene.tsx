'use client';

import { ExamplesCanvas } from '@/components/ExamplesCanvas';
import { FpsDebug } from '@/components/FpsDebug';
import {
    resolveTerrainMaterialAppearance,
    tileColorsLevaControl,
} from '@/examples/terrain/tileInstanceColor';
import { RunTimingBars } from '@/components/RunTimingBars';
import { TerrainTileDebug } from '@/components/TerrainTileDebug';
import {
    deriveNormalZ,
    textureSpaceToVectorSpace,
    vectorSpaceToTextureSpace,
    terrainDetailNormal,
    voronoiCells,
    type ElevationCallback,
    type TerrainGraph,
} from '@hello-terrain/three';
import { Terrain, useTerrain } from '@hello-terrain/react';
import { Environment, OrbitControls } from '@react-three/drei';
import { Canvas, extend, useLoader, useThree } from '@react-three/fiber';
import { useControls, useCreateStore } from 'leva';

type LevaStore = ReturnType<typeof useCreateStore>;
import { useEffect, useMemo, useState } from 'react';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { WebGPURendererParameters } from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { float, Fn, max, positionWorld, texture, vec2, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';

extend(THREE as any);

type TerrainMeshSceneImplProps = {
    onGraphReady: (graph: TerrainGraph) => void;
    store: LevaStore;
};

const TerrainMeshSceneImpl = ({ onGraphReady, store }: TerrainMeshSceneImplProps) => {
    const controls = useControls(
        'TerrainGeometry',
        {
            rootSize: {
                value: 1024,
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
                min: 1,
                max: 1000,
                step: 1,
                label: 'elevation scale',
            },
            wireframe: {
                value: false,
            },
            tileColors: tileColorsLevaControl,
            heightmapStrength: {
                value: 25,
                min: 0,
                max: 100,
                step: 1,
                label: 'heightmap strength',
            },
        },
        { store }
    );

    const { gl } = useThree();

    const heightmapTexture = useLoader(
        EXRLoader,
        'https://hello-terrain.kenny.wtf/external/badian-dessert.exr'
    );
    heightmapTexture.wrapS = heightmapTexture.wrapT = THREE.ClampToEdgeWrapping;
    heightmapTexture.minFilter = THREE.LinearFilter;
    heightmapTexture.magFilter = THREE.LinearFilter;

    const [albedo, normal, aorh] = useLoader(
        KTX2Loader,
        [
            '/assets/materials/sand-bright/sand_bright_albedo.ktx2',
            '/assets/materials/sand-bright/sand_bright_normal.ktx2',
            '/assets/materials/sand-bright/sand_bright_aorh.ktx2',
        ],
        async (loader) => {
            loader.setTranscoderPath(
                'https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/basis/'
            );
            loader.detectSupport(gl);
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
                const hasBCCompression = adapter.features.has('texture-compression-bc');
                if (!hasBCCompression) {
                    alert('Your device is not supported (no BCn compression)');
                }
            }
        }
    );
    normal.colorSpace = THREE.LinearSRGBColorSpace;

    albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    aorh.wrapS = aorh.wrapT = THREE.RepeatWrapping;

    const terrainColorNode = useMemo(
        () =>
            Fn(() => {
                const worldUv = vec2(positionWorld.x, positionWorld.z);
                const tint = vec3(221, 145, 73).div(255);
                return texture(albedo, worldUv).mul(tint);
            })(),
        [albedo]
    );

    const materialAppearance = resolveTerrainMaterialAppearance({
        tileColors: controls.tileColors,
        wireframe: controls.wireframe,
        colorNode: terrainColorNode,
        wireframeColor: 'red',
    });

    const elevation = useMemo<ElevationCallback>(
        () =>
            ({ worldPosition, rootUV }) => {
                const noise = voronoiCells({
                    scale: float(1),
                    facet: 0,
                    seed: 0,
                    uv: vec2(worldPosition.x, worldPosition.z).mul(0.5),
                }).mul(0.5);
                const height = texture(heightmapTexture, rootUV)
                    .level(float(0))
                    .x.clamp(0, 1)
                    .mul(controls.heightmapStrength);
                return max(noise, height);
            },
        [heightmapTexture, controls.heightmapStrength]
    );
    const terrain = useTerrain({
        rootSize: controls.rootSize,
        maxLevel: controls.maxLevel,
        maxNodes: controls.maxNodes,
        skirtScale: controls.skirtScale,
        elevationScale: controls.elevationScale,
        elevation,
        elevationRange: { min: 0, max: Math.max(0.5, controls.heightmapStrength) },
    });
    useEffect(() => onGraphReady(terrain.graph), [onGraphReady, terrain.graph]);
    const materialNodes = useMemo(() => {
        const context = terrain.materialContext;
        if (!context) return null;
        const mappingUV = vec2(context.datumPositionLocal.x, context.datumPositionLocal.z);
        const reconstructed = deriveNormalZ(textureSpaceToVectorSpace(texture(normal, mappingUV).rg));
        return {
            normalNode: terrainDetailNormal(
                context,
                vectorSpaceToTextureSpace(reconstructed),
                mappingUV
            ),
            aoNode: textureSpaceToVectorSpace(texture(aorh, mappingUV).r).negate(),
            roughnessNode: textureSpaceToVectorSpace(texture(aorh, mappingUV).g).negate(),
        };
    }, [terrain.materialContext, normal, aorh]);

    return (
        <>
            <Environment
                files={['https://hello-terrain.kenny.wtf/external/night-glow.exr']}
                background
            />
            <Terrain terrain={terrain}>
                {({ positionNode }) => (
                    <meshStandardNodeMaterial
                        positionNode={positionNode}
                        wireframe={materialAppearance.wireframe}
                        metalness={0.1}
                        color={materialAppearance.color}
                        colorNode={materialAppearance.colorNode}
                        {...materialNodes}
                    />
                )}
            </Terrain>
        </>
    );
};

const TerrainElevationScene = () => {
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
                    position: [0, 3, 1],
                }}
                dpr={[1, 1]}
                performance={{ min: 0.5 }}
            >
                <ambientLight intensity={0.15} />
                <directionalLight intensity={1} position={[1, 1, 1]} />
                <TerrainMeshSceneImpl onGraphReady={setGraph} store={store} />
                <OrbitControls makeDefault target={[0, 3, 100]} />
            </Canvas>
        </ExamplesCanvas>
    );
};
export default TerrainElevationScene;
