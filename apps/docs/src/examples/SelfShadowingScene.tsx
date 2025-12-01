"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import { voronoiCells } from "@/components/Terrain/lib/TSLNodes/Voronoi";
import * as hello from "@hello-terrain/react";
import { ElevationFn, type TerrainMesh } from "@hello-terrain/three";
import { OrbitControls, Sky } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";

import { useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  float,
  mix,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

// biome-ignore lint/suspicious/noExplicitAny: <idk its recommended way from drei>
extend(THREE as any);

const VERTEX_COUNT = 32;
const SEGMENT_COUNT = VERTEX_COUNT - 3;

const TerrainPlane = () => {
  const { camera, gl } = useThree();
  const [helloTerrainMesh, setHelloTerrainMesh] = useState<TerrainMesh | null>(
    null
  );
  const sunRef = useRef<THREE.DirectionalLight>(null);

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
    "activeLeafCount",
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
      max: 1_024_000,
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
    heightmapScale: {
      value: 8,
      min: 0.0,
      max: 1000.0,
      step: 0.1,
      label: "Heightmap Scale",
    },
    fbmNoiseScale: {
      value: 0.01,
      min: -1,
      max: 1,
      step: 0.0001,
      label: "FBM Noise Scale",
    },
  });

  const shadowControls = useControls("Shadows", {
    enabled: {
      value: true,
      label: "Enable Shadows",
    },
    shadowMapSize: {
      value: 4096,
      options: [1024, 2048, 4096, 8192],
      label: "Shadow Map Size",
    },
    shadowBias: {
      value: -0.0001,
      min: -0.01,
      max: 0.01,
      step: 0.0001,
      label: "Shadow Bias",
    },
    normalBias: {
      value: 0.5,
      min: 0,
      max: 5,
      step: 0.1,
      label: "Normal Bias",
    },
    shadowRadius: {
      value: 2,
      min: 0,
      max: 10,
      step: 0.5,
      label: "Shadow Blur",
    },
  });

  const sunControls = useControls("Sun", {
    azimuth: {
      value: 0.25,
      min: 0,
      max: 1,
      step: 0.01,
      label: "Azimuth",
    },
    elevation: {
      value: 0.15,
      min: 0.01,
      max: 0.5,
      step: 0.01,
      label: "Elevation",
    },
    intensity: {
      value: 3,
      min: 0.5,
      max: 10,
      step: 0.1,
      label: "Intensity",
    },
  });

  const elevationUniforms = useMemo(() => {
    return {
      uHeightmapScale: uniform(1.0).setName("uHeightmapScale"),
      uNoiseScale: uniform(1.0).setName("uNoiseScale"),
    };
  }, []);

  // Calculate sun position from azimuth/elevation
  const sunPosition = useMemo(() => {
    const phi = (0.5 - sunControls.elevation) * Math.PI;
    const theta = sunControls.azimuth * Math.PI * 2;
    const distance = terrainGeometryControls.rootSize;
    return new THREE.Vector3(
      distance * Math.sin(phi) * Math.cos(theta),
      distance * Math.cos(phi),
      distance * Math.sin(phi) * Math.sin(theta)
    );
  }, [
    sunControls.azimuth,
    sunControls.elevation,
    terrainGeometryControls.rootSize,
  ]);

  const colorNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0.76, 0.6, 0.42); // Sandy base color
      })();
    }
    return Fn(() => {
      const normal = helloTerrainMesh.varyings.vNormal;
      const height = helloTerrainMesh.varyings.vElevation;

      // Desert dune color palette
      const shadowSand = vec3(0.55, 0.4, 0.28); // Darker sand in shadows/valleys
      const midSand = vec3(0.76, 0.6, 0.42); // Warm golden sand
      const brightSand = vec3(0.92, 0.82, 0.65); // Sun-bleached dune crests
      const hotSand = vec3(0.85, 0.68, 0.45); // Slightly orange warm sand

      // Normalize height for color blending
      const normalizedHeight = height.div(
        elevationUniforms.uHeightmapScale.mul(10)
      );

      // Slope factor from normal (steeper = more shadow)
      const slopeFactor = float(1).sub(normal.y);

      // Base color gradient from valleys to peaks
      const heightColor = mix(
        mix(shadowSand, midSand, normalizedHeight.smoothstep(0.1, 0.4)),
        brightSand,
        normalizedHeight.smoothstep(0.6, 0.9)
      );

      // Add warmth variation based on slope (windward vs leeward sides)
      const finalColor = mix(
        heightColor,
        hotSand,
        slopeFactor.smoothstep(0.2, 0.5)
      );

      return finalColor;
    })();
  }, [helloTerrainMesh, elevationUniforms.uHeightmapScale]);

  useFrame(async () => {
    // Elevation uniforms updated from controls each frame
    elevationUniforms.uHeightmapScale.value =
      terrainGeometryControls.heightmapScale;
    elevationUniforms.uNoiseScale.value = terrainGeometryControls.fbmNoiseScale;

    // Update sun position
    if (sunRef.current) {
      sunRef.current.position.copy(sunPosition);
      sunRef.current.intensity = sunControls.intensity;

      // Configure shadow camera to cover the terrain
      const halfSize = terrainGeometryControls.rootSize * 0.6;
      sunRef.current.shadow.camera.left = -halfSize;
      sunRef.current.shadow.camera.right = halfSize;
      sunRef.current.shadow.camera.top = halfSize;
      sunRef.current.shadow.camera.bottom = -halfSize;
      sunRef.current.shadow.camera.near = 0.5;
      sunRef.current.shadow.camera.far = terrainGeometryControls.rootSize * 2.5;
      sunRef.current.shadow.bias = shadowControls.shadowBias;
      sunRef.current.shadow.normalBias = shadowControls.normalBias;
      sunRef.current.shadow.radius = shadowControls.shadowRadius;
      sunRef.current.shadow.camera.updateProjectionMatrix();
    }

    if (helloTerrainMesh) {
      // Update instance-specific uniforms
      helloTerrainMesh.uniforms.uSegments.value =
        terrainGeometryControls.segments;
      helloTerrainMesh.uniforms.setSkirtHeight(
        terrainGeometryControls.skirtLength
      );
      helloTerrainMesh.uniforms.setHeightmapScale(
        terrainGeometryControls.heightmapScale
      );

      // Keep quadtree config in sync with UI controls so subdivision matches rootSize changes
      const qConfig = helloTerrainMesh.quadtree.getConfig();
      qConfig.rootSize = terrainGeometryControls.rootSize;
      qConfig.minNodeSize = terrainGeometryControls.minNodeSize;
      qConfig.subdivisionFactor = terrainGeometryControls.subdivisionFactor;
      qConfig.maxLevel = terrainGeometryControls.maxLevel;
      const frustum = new THREE.Frustum();

      const projScreenMatrix = new THREE.Matrix4();
      projScreenMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      );
      frustum.setFromProjectionMatrix(projScreenMatrix);
      helloTerrainMesh.update(
        gl as unknown as THREE.WebGPURenderer,
        camera.position,
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
      setMetric(
        "activeLeafCount",
        (helloTerrainMesh.metrics.activeLeafCount ?? "").toString()
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
      const noiseScale = elevationUniforms.uNoiseScale;
      const noise = voronoiCells({
        scale: float(1),
        facet: 0,
        seed: 0,
        uv: vec2(worldPosition.x, worldPosition.z).mul(noiseScale),
      }).mul(elevationUniforms.uHeightmapScale);

      return noise;
    });
  }, [elevationUniforms]);

  const positionNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return helloTerrainMesh.positionNode();
  }, [helloTerrainMesh]);

  const normalNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 1, 0);
      })();
    }
    return transformNormalToView(helloTerrainMesh.varyings.vNormal);
  }, [helloTerrainMesh]);

  return (
    <>
      {/* Sun light with shadows */}
      <directionalLight
        ref={sunRef}
        intensity={sunControls.intensity}
        position={sunPosition}
        castShadow={shadowControls.enabled}
        shadow-mapSize-width={shadowControls.shadowMapSize}
        shadow-mapSize-height={shadowControls.shadowMapSize}
      />

      {/* Ambient fill light - warm desert bounce light */}
      <ambientLight intensity={0.25} color="#f5e6d3" />

      {/* Hemisphere light for sky/ground bounce */}
      <hemisphereLight intensity={0.3} color="#87ceeb" groundColor="#d4a574" />

      <group>
        <hello.TerrainMesh
          receiveShadow={shadowControls.enabled}
          castShadow={shadowControls.enabled}
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
            normalNode={normalNode}
          />
        </hello.TerrainMesh>
        <axesHelper scale={terrainGeometryControls.rootSize * 1.1} />
      </group>
    </>
  );
};

const SelfShadowingScene = () => {
  return (
    <Canvas
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
      }}
      shadows="soft"
      gl={async (props) => {
        props.alpha = true;
        props.antialias = true;
        // @ts-ignore
        props.requiredLimits = {
          maxComputeWorkgroupsPerDimension: 65535,
          maxComputeWorkgroupSizeX: 1024,
          maxComputeWorkgroupSizeY: 1024,
          maxComputeWorkgroupSizeZ: 64,
        };
        const renderer = new THREE.WebGPURenderer(
          props as WebGPURendererParameters
        );

        renderer.logarithmicDepthBuffer = true;
        // renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      {/* Desert sky - warm hazy atmosphere */}
      <color attach="background" args={["#e8d5b5"]} />
      <fog attach="fog" args={["#d4c4a8", 100, 1024 * 3]} />

      <Sky
        distance={450000}
        sunPosition={[1000, 300, 500]}
        inclination={0.48}
        azimuth={0.25}
        rayleigh={0.2}
        turbidity={12}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />

      <OrbitControls />
      <TerrainPlane />
    </Canvas>
  );
};

export default SelfShadowingScene;
