"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import { vec2_fbm } from "@/components/Terrain/fmb";
import { voronoiCells } from "@/components/Terrain/lib/TSLNodes/Voronoi";
import * as hello from "@hello-terrain/react";
import {
  ElevationFn,
  type TerrainMesh,
  isSkirtVertex,
  tileGeometryPosition,
  tileIsLeaf,
  uRootOrigin,
  uRootSize,
  uSegments,
  uSkirtLength,
} from "@hello-terrain/three";
import { OrbitControls, useTexture } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";

import { useEffect, useMemo, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  float,
  hash,
  instanceIndex,
  int,
  positionLocal,
  select,
  uniform,
  varying,
  vec2,
  vec3,
  vertexIndex,
} from "three/tsl";
import * as THREE from "three/webgpu";

// biome-ignore lint/suspicious/noExplicitAny: <idk its recommended way from drei>
extend(THREE as any);

const VERTEX_COUNT = 32;
const SEGMENT_COUNT = VERTEX_COUNT - 3;

const PERSISTENCE = 0.5;
const LACUNARITY = 2.1369;

const TerrainPlane = () => {
  const { camera, gl } = useThree();
  const [helloTerrainMesh, setHelloTerrainMesh] = useState<TerrainMesh | null>(
    null
  );

  const setMetric = useMetrics([
    "updatePosition",
    "heightmapComputeTime",
    "nodeCount",
    "deepestLevel",
    "hash",
    "hasStateChanged",
    "lastUpdateHeight",
    "closestLeafIndex",
  ] as const);

  const terrainGeometryControls = useControls("TerrainGeometry", {
    segments: {
      value: SEGMENT_COUNT,
      min: 2,
      max: 256 - 3,
      step: 2,
      label: "Segments",
    },
    skirtLength: {
      value: 1,
      min: 0,
      max: 10000,
      step: 0.2,
      label: "Skirt Length",
    },
    wireframe: {
      value: false,
      label: "Wireframe",
    },
    maxLevel: {
      value: 10,
      min: 1,
      max: 32,
      step: 1,
      label: "Max Level",
    },
    maxNodes: {
      value: 1000,
      min: 100,
      max: 10000,
      step: 100,
      label: "Max Nodes",
    },
    rootSize: {
      value: SEGMENT_COUNT * 100,
      min: 1,
      max: 10000,
      step: 1,
      label: "Root Size",
    },
    minNodeSize: {
      value: SEGMENT_COUNT,
      min: 0.1,
      max: 10000,
      step: 0.1,
      label: "Min Node Size",
    },
    subdivisionFactor: {
      value: 2,
      min: 0.1,
      max: 3,
      step: 0.1,
      label: "Subdivision Factor",
    },
    useTexture: {
      value: false,
      label: "Use Texture",
    },
    heightmapScale: {
      value: SEGMENT_COUNT,
      min: 0.0,
      max: 1000.0,
      step: 0.1,
      label: "Heightmap Scale",
    },
    fbmIterations: {
      value: 8,
      min: 1,
      max: 30,
      step: 1,
      label: "FBM Iterations",
    },
    fbmAmplitude: {
      value: 100,
      min: 0.0,
      max: 100.0,
      step: 0.001,
      label: "FBM Amplitude",
    },
    fbmFrequency: {
      value: 0.0001,
      min: 0.0,
      max: 10.0,
      step: 0.00001,
      label: "FBM Frequency",
    },
    fbmLacunarity: {
      value: LACUNARITY,
      min: 0.0,
      max: 10.0,
      step: 0.1,
      label: "FBM Lacunarity",
    },
    fbmPersistence: {
      value: PERSISTENCE,
      min: 0.0,
      max: 1.0,
      step: 0.01,
      label: "FBM Persistence",
    },
    fbmNoiseScale: {
      value: 0.01,
      min: -1,
      max: 1,
      step: 0.0001,
      label: "FBM Noise Scale",
    },
  });

  const uvMap = useTexture("/assets/uv-12x12.png");

  console.log({ helloTerrainMesh });

  // Memoized varyings
  const uniforms = useMemo(() => {
    return {
      uWireframe: uniform(false).setName("uWireframe"),
      uUseTexture: uniform(false).setName("uUseTexture"),
    };
  }, []);

  const elevationUniforms = useMemo(() => {
    return {
      uFbmIterations: uniform(8).setName("uFbmIterations"),
      uFbmAmplitude: uniform(1.0).setName("uFbmAmplitude"),
      uFbmFrequency: uniform(0.005).setName("uFbmFrequency"),
      uFbmLacunarity: uniform(2.0).setName("uFbmLacunarity"),
      uFbmPersistence: uniform(0.5).setName("uFbmPersistence"),
      uHeightmapScale: uniform(1.0).setName("uHeightmapScale"),
      uNoiseScale: uniform(1.0).setName("uNoiseScale"),
    };
  }, []);

  const varyings = useMemo(() => {
    return {
      vElevation: varying(float(), "vElevation"),
    };
  }, []);

  useEffect(() => {
    uRootOrigin.value = new THREE.Vector3(0, 0, 0);
    uRootSize.value = terrainGeometryControls.rootSize;
  }, [terrainGeometryControls.rootSize]);

  // Shared varying for global vertex index
  const vGlobalVertexIndex = useMemo(() => varying(int()), []);

  // Memoized nodes
  const positionNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return Fn(() => {
      const nodeStorage = helloTerrainMesh.tileNode;
      const nodeIndex = instanceIndex;
      const rootSize = uRootSize.toVar();
      const rootOrigin = uRootOrigin.toVar();
      const skirtLength = uSkirtLength.toVar();
      const worldPosition = tileGeometryPosition(
        nodeIndex,
        nodeStorage,
        rootSize,
        rootOrigin,
        positionLocal,
        skirtLength
      );
      const isLeaf = tileIsLeaf(nodeIndex, nodeStorage);

      // Compute and pass global vertex index to fragment stage
      const edgeVertexCount = uSegments.toVar().add(3);
      const intEdgeVertexCount = int(edgeVertexCount);
      const verticesPerNode = intEdgeVertexCount.mul(intEdgeVertexCount);
      const globalIndex = nodeIndex.mul(verticesPerNode).add(vertexIndex);
      vGlobalVertexIndex.assign(globalIndex);

      const height = helloTerrainMesh.heightmapNode
        .element(vGlobalVertexIndex)
        .mul(elevationUniforms.uHeightmapScale.toVar());
      varyings.vElevation.assign(height);

      const beforeTransform = select(
        isSkirtVertex,
        vec3(worldPosition.x, worldPosition.y, worldPosition.z),
        vec3(worldPosition.x, worldPosition.y.add(height), worldPosition.z)
      );

      return select(isLeaf, beforeTransform, vec3(0, 0, 0));
    })();
  }, [
    vGlobalVertexIndex,
    varyings.vElevation,
    elevationUniforms.uHeightmapScale,
    helloTerrainMesh,
  ]);

  const colorNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return Fn(() => {
      const height = varyings.vElevation
        .remap(0, elevationUniforms.uHeightmapScale.toVar(), 0, 1)
        .toColor();
      const nodeHashColor = vec3(
        hash(instanceIndex),
        hash(instanceIndex.add(1)),
        hash(instanceIndex.add(2))
      ).toColor();

      // Return the color
      return height.oneMinus().mix(nodeHashColor, 0.5);
    })();
  }, [
    helloTerrainMesh,
    varyings.vElevation,
    elevationUniforms.uHeightmapScale,
  ]);

  useFrame(async () => {
    uniforms.uWireframe.value = terrainGeometryControls.wireframe;
    uniforms.uUseTexture.value = terrainGeometryControls.useTexture;
    uSegments.value = terrainGeometryControls.segments;
    uSkirtLength.value = terrainGeometryControls.skirtLength;
    uRootSize.value = terrainGeometryControls.rootSize;
    // Elevation uniforms updated from controls each frame
    elevationUniforms.uFbmIterations.value =
      terrainGeometryControls.fbmIterations;
    elevationUniforms.uFbmAmplitude.value =
      terrainGeometryControls.fbmAmplitude;
    elevationUniforms.uFbmFrequency.value =
      terrainGeometryControls.fbmFrequency;
    elevationUniforms.uFbmLacunarity.value =
      terrainGeometryControls.fbmLacunarity;
    elevationUniforms.uFbmPersistence.value =
      terrainGeometryControls.fbmPersistence;
    elevationUniforms.uFbmIterations.value =
      terrainGeometryControls.fbmIterations;
    elevationUniforms.uFbmAmplitude.value =
      terrainGeometryControls.fbmAmplitude;
    elevationUniforms.uFbmFrequency.value =
      terrainGeometryControls.fbmFrequency;
    elevationUniforms.uFbmLacunarity.value =
      terrainGeometryControls.fbmLacunarity;
    elevationUniforms.uFbmPersistence.value =
      terrainGeometryControls.fbmPersistence;
    elevationUniforms.uHeightmapScale.value =
      terrainGeometryControls.heightmapScale;
    elevationUniforms.uNoiseScale.value = terrainGeometryControls.fbmNoiseScale;
    if (helloTerrainMesh) {
      // Keep quadtree config in sync with UI controls so subdivision matches rootSize changes
      const qConfig = helloTerrainMesh.quadtree.getConfig();
      qConfig.rootSize = terrainGeometryControls.rootSize;
      qConfig.minNodeSize = terrainGeometryControls.minNodeSize;
      qConfig.subdivisionFactor = terrainGeometryControls.subdivisionFactor;
      qConfig.maxLevel = terrainGeometryControls.maxLevel;
      helloTerrainMesh.update(
        gl as unknown as THREE.WebGPURenderer,
        camera.position
      );
      setMetric(
        "updatePosition",
        helloTerrainMesh.metrics.updatePosition.toString()
      );
      setMetric(
        "hasStateChanged",
        helloTerrainMesh.metrics.hasStateChanged.toString()
      );
      setMetric(
        "deepestLevel",
        helloTerrainMesh.metrics.deepestLevel.toString()
      );
      setMetric(
        "nodeCount",
        `${helloTerrainMesh.metrics.leafNodeCount} / ${helloTerrainMesh.metrics.nodeCount}`
      );
      setMetric("hash", helloTerrainMesh.metrics.hash.toString());
      setMetric(
        "heightmapComputeTime",
        helloTerrainMesh.metrics.heightmapComputeTime.toString()
      );
      setMetric(
        "lastUpdateHeight",
        helloTerrainMesh.metrics.lastUpdateHeight.toString()
      );
      setMetric(
        "closestLeafIndex",
        helloTerrainMesh.metrics.closestLeafIndex.toString()
      );
    }
  });

  const elevationFn = useMemo(() => {
    return ElevationFn(({ worldPosition }) => {
      const noiseScale = elevationUniforms.uNoiseScale.toVar();
      const fbm = vec2_fbm(
        vec2(worldPosition.x, worldPosition.z).mul(noiseScale),
        int(elevationUniforms.uFbmIterations.toVar()),
        elevationUniforms.uFbmAmplitude.toVar(),
        elevationUniforms.uFbmFrequency.toVar(),
        elevationUniforms.uFbmLacunarity.toVar(),
        elevationUniforms.uFbmPersistence.toVar()
      );
      const noise = voronoiCells({
        scale: noiseScale,
        facet: 0,
        seed: 0,
        uv: vec2(worldPosition.x, worldPosition.z),
      }).add(fbm);

      return noise;
    });
  }, [elevationUniforms]);

  return (
    <group>
      {/* <Html>
        <div className="flex flex-col items-center justify-center border-2 border-white rounded-md p-2 bg-black/50">
          <span className="text-white text-lg text-shadow-xl">TerrainMesh</span>
        </div>
      </Html> */}
      <hello.TerrainMesh
        receiveShadow
        castShadow
        frustumCulled={false}
        ref={(ref) => {
          if (!helloTerrainMesh && ref) {
            console.log("setting helloTerrainMesh", ref);
            setHelloTerrainMesh(ref);
          }
        }}
        elevationFn={elevationFn}
        maxNodes={terrainGeometryControls.maxNodes}
        rootSize={terrainGeometryControls.rootSize}
        innerTileSegments={terrainGeometryControls.segments}
        subdivisionFactor={terrainGeometryControls.subdivisionFactor}
        minNodeSize={terrainGeometryControls.minNodeSize}
        maxLevel={terrainGeometryControls.maxLevel}
      >
        <meshStandardNodeMaterial
          name="TerrainMeshMaterial"
          wireframe={terrainGeometryControls.wireframe}
          positionNode={positionNode}
          colorNode={colorNode}
        />
      </hello.TerrainMesh>
      <axesHelper scale={terrainGeometryControls.rootSize * 1.1} />
    </group>
  );
};

const BasicComputeScene = () => {
  return (
    <Canvas
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
      }}
      shadows
      gl={async (props) => {
        props.alpha = true;
        props.antialias = true;
        // @ts-ignore
        props.requiredLimits = {
          maxComputeWorkgroupsPerDimension: 65535, // Much higher limit
          maxComputeWorkgroupSizeX: 1024,
          maxComputeWorkgroupSizeY: 1024,
          maxComputeWorkgroupSizeZ: 64,
        };
        // soft shadows
        const renderer = new THREE.WebGPURenderer(
          props as WebGPURendererParameters
        );

        renderer.logarithmicDepthBuffer = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.shadowMap.enabled = true;

        await renderer.init();
        return renderer;
      }}
      camera={{
        near: 0.1,
        far: Number.MAX_SAFE_INTEGER,
        position: [3, 0, 3],
      }}
      dpr={[1, 1]}
      performance={{ min: 0.5 }}
    >
      <color attach="background" args={["#6dd1ed"]} />
      {/* <Environment preset="park" background={false} environmentIntensity={1} /> */}
      <ambientLight intensity={0.15} />
      <directionalLight intensity={1} position={[1, 1, 1]} />
      <OrbitControls />
      <TerrainPlane />
    </Canvas>
  );
};

export default BasicComputeScene;
