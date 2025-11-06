"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import { vec2_fbm } from "@/components/Terrain/fmb";
import { voronoiCells } from "@/components/Terrain/lib/TSLNodes/Voronoi";
import * as hello from "@hello-terrain/react";
import {
  ElevationFn,
  type TerrainMesh,
  uRootOrigin,
  uRootSize,
  uSegments,
  uSkirtHeight,
  vNormal,
  worldPosition,
} from "@hello-terrain/three";
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  float,
  hash,
  instanceIndex,
  int,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
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
  const cameraHelperRef = useRef<THREE.CameraHelper | null>(null);
  const newCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const setMetric = useMetrics([
    "updatePosition",
    "heightmapComputeTime",
    "nodeCount",
    "deepestLevel",
    "hash",
    "hasStateChanged",
    "lastUpdateHeight",
    "closestLeafIndex",
    "normalmapComputeTime",
    "lastUpdateHeightComputeTime",
    "updateTime",
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
      max: 1024_000,
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
      value: 0.1,
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

  // const uvMap = useTexture("/assets/uv-12x12.png");

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
      // return nodeHashColor;
      // return height.toColor();
      // return vec3(124, 252, 0).div(255).toColor();

      return vNormal.toColor();
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
    uSkirtHeight.value = terrainGeometryControls.skirtLength;
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
      const frustum = new THREE.Frustum();

      // move the newCamera slightly

      const movementSin = Math.sin(performance.now() * 0.001) * 100;

      newCameraRef.current?.position.set(movementSin, 50, movementSin);
      // newCameraRef.current?.position.y += movementSin;
      // newCameraRef.current?.position.z += movementSin;
      newCameraRef.current?.updateMatrixWorld();
      cameraHelperRef.current?.setColors(
        new THREE.Color("red"),
        new THREE.Color("green"),
        new THREE.Color("blue"),
        new THREE.Color("yellow"),
        new THREE.Color("purple")
      );

      const projScreenMatrix = new THREE.Matrix4();
      projScreenMatrix.multiplyMatrices(
        newCameraRef.current?.projectionMatrix ?? new THREE.Matrix4(),
        newCameraRef.current?.matrixWorldInverse ?? new THREE.Matrix4()
      );
      frustum.setFromProjectionMatrix(projScreenMatrix);

      // cameraHelperRef.current?.camera.copy(newCamera);
      // cameraHelperRef.current?.update();
      helloTerrainMesh.update(
        gl as unknown as THREE.WebGPURenderer,
        newCameraRef.current?.position ?? new THREE.Vector3(),
        frustum
      );
      setMetric(
        "updatePosition",
        (helloTerrainMesh.metrics.updatePosition ?? "").toString()
      );
      setMetric(
        "hasStateChanged",
        (helloTerrainMesh.metrics.hasStateChanged ?? "").toString()
      );
      setMetric(
        "deepestLevel",
        (helloTerrainMesh.metrics.deepestLevel ?? "").toString()
      );
      setMetric(
        "nodeCount",
        `${helloTerrainMesh.metrics.leafNodeCount} / ${helloTerrainMesh.metrics.nodeCount}`
      );
      setMetric("hash", (helloTerrainMesh.metrics.hash ?? "").toString());
      setMetric(
        "heightmapComputeTime",
        (helloTerrainMesh.metrics.heightmapComputeTime ?? "").toString()
      );
      setMetric(
        "lastUpdateHeightComputeTime",
        (helloTerrainMesh.metrics.lastUpdateHeightComputeTime ?? "").toString()
      );
      setMetric(
        "lastUpdateHeight",
        (helloTerrainMesh.metrics.lastUpdateHeight ?? "").toString()
      );
      setMetric(
        "closestLeafIndex",
        (helloTerrainMesh.metrics.closestLeafIndex ?? "").toString()
      );
      setMetric(
        "normalmapComputeTime",
        (helloTerrainMesh.metrics.normalmapComputeTime ?? "").toString()
      );
      setMetric(
        "updateTime",
        (helloTerrainMesh.metrics.updateTime ?? "").toString()
      );
    }
  });

  const elevationFn = useMemo(() => {
    return ElevationFn(({ worldPosition }) => {
      // worldPosition is correct!
      // rootUV is correct!
      // Bug: when this is changed, the terrain is no longer rendered properly
      // that's an issue with the elevationFn set method on the class
      const noiseScale = elevationUniforms.uNoiseScale;
      const fbm = vec2_fbm(
        vec2(worldPosition.x, worldPosition.z).mul(noiseScale),
        int(elevationUniforms.uFbmIterations.toVar()),
        elevationUniforms.uFbmAmplitude.toVar(),
        elevationUniforms.uFbmFrequency.toVar(),
        elevationUniforms.uFbmLacunarity.toVar(),
        elevationUniforms.uFbmPersistence.toVar()
      );
      const scale = elevationUniforms.uHeightmapScale;
      const noise = voronoiCells({
        scale: float(1),
        facet: 0,
        seed: 0,
        uv: vec2(worldPosition.x, worldPosition.z).mul(noiseScale),
      }).mul(scale);

      return noise;
      // return max(worldPosition.x, worldPosition.z).mul(
      //   elevationUniforms.uHeightmapScale.toVar()
      // );
    });
  }, [elevationUniforms]);

  const normalNode = useMemo(() => {
    return transformNormalToView(vNormal);
  }, []);

  return (
    <>
      <group>
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
            positionNode={worldPosition()}
            colorNode={colorNode}
            normalNode={normalNode}
          />
        </hello.TerrainMesh>
        <axesHelper scale={terrainGeometryControls.rootSize * 1.1} />
      </group>
      <cameraHelper
        args={[newCameraRef.current ?? new THREE.Camera()]}
        ref={cameraHelperRef}
      />
      <perspectiveCamera
        ref={newCameraRef}
        args={[undefined, undefined, 1, terrainGeometryControls.rootSize * 2]}
      />
      {/* <fog attach="fog" args={["#6dd1ed", 0, 1024 * 2]} /> */}
    </>
  );
};

const FrustumCullingScene = () => {
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
      <Environment preset="park" background={false} environmentIntensity={1} />
      <ambientLight intensity={0.15} />
      <directionalLight intensity={1} position={[1, 1, 1]} />
      <OrbitControls />
      <TerrainPlane />
    </Canvas>
  );
};

export default FrustumCullingScene;
