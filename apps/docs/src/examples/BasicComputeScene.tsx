"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import * as hello from "@hello-terrain/react";
import {
  type TerrainMesh,
  isSkirtVertex,
  rootUV,
  tileIsLeaf,
  tileVertexWorldPosition,
  uRootOrigin,
  uRootSize,
  uSegments,
  uSkirtLength,
} from "@hello-terrain/three";
import {
  Environment,
  Html,
  OrbitControls,
  useTexture,
} from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  float,
  hash,
  instanceIndex,
  select,
  texture,
  uniform,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

// biome-ignore lint/suspicious/noExplicitAny: <idk its recommended way from drei>
extend(THREE as any);

const TerrainPlane = () => {
  const { camera } = useThree();
  const [helloTerrainMesh, setHelloTerrainMesh] = useState<TerrainMesh | null>(
    null
  );

  const setMetric = useMetrics([
    "updatePosition",
    "nodeCount",
    "deepestLevel",
    "hash",
    "hasStateChanged",
  ] as const);

  const terrainGeometryControls = useControls("TerrainGeometry", {
    segments: {
      value: 10,
      min: 2,
      max: 1024,
      step: 16,
      label: "Segments",
    },
    skirtLength: {
      value: 1,
      min: 0,
      max: 20,
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
      value: 10,
      min: 1,
      max: 10000,
      step: 1,
      label: "Root Size",
    },
    minNodeSize: {
      value: 0.1,
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
  });

  const uvMap = useTexture("/assets/uv-12x12.png");

  // Memoized varyings
  const uniforms = useMemo(() => {
    return {
      uWireframe: uniform(false).setName("uWireframe"),
      uUseTexture: uniform(false).setName("uUseTexture"),
    };
  }, []);

  useEffect(() => {
    uRootOrigin.value = new THREE.Vector3(0, 0, 0);
    uRootSize.value = terrainGeometryControls.rootSize;
  }, [terrainGeometryControls.rootSize]);

  // Memoized nodes
  const positionNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return Fn(() => {
      const nodeStorage = helloTerrainMesh.nodeStorage.storageNode;
      const worldPosition = tileVertexWorldPosition(nodeStorage);
      const isLeaf = tileIsLeaf(nodeStorage);
      const skirtLength = uSkirtLength.toVar();

      const beforeTransform = select(
        isSkirtVertex,
        vec3(
          worldPosition.x,
          worldPosition.y.sub(float(skirtLength)),
          worldPosition.z
        ),
        worldPosition
      );
      return select(isLeaf, beforeTransform, vec3(0, 0, 0));
    })();
  }, [helloTerrainMesh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the uniform will be updated by the useFrame hook
  const colorNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return Fn(() => {
      const worldUv = rootUV;
      const textureColor = texture(uvMap, worldUv);
      const indexHashColor = vec3(
        hash(instanceIndex),
        hash(instanceIndex.add(1)),
        hash(instanceIndex.add(2))
      );

      return select(
        uniforms.uWireframe,
        vec3(1, 0, 0),
        select(uniforms.uUseTexture, textureColor, indexHashColor)
      );
    })();
  }, [helloTerrainMesh]);

  useFrame(() => {
    uniforms.uWireframe.value = terrainGeometryControls.wireframe;
    uniforms.uUseTexture.value = terrainGeometryControls.useTexture;
    uSegments.value = terrainGeometryControls.segments;
    uSkirtLength.value = terrainGeometryControls.skirtLength;
    uRootSize.value = terrainGeometryControls.rootSize;
    if (helloTerrainMesh) {
      // Keep quadtree config in sync with UI controls so subdivision matches rootSize changes
      const qConfig = helloTerrainMesh.quadtree.getConfig();
      qConfig.rootSize = terrainGeometryControls.rootSize;
      qConfig.minNodeSize = terrainGeometryControls.minNodeSize;
      qConfig.subdivisionFactor = terrainGeometryControls.subdivisionFactor;
      qConfig.maxLevel = terrainGeometryControls.maxLevel;
      helloTerrainMesh.update(camera.position);
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
    }
  });

  useEffect(() => {
    return () => {
      if (helloTerrainMesh) {
        helloTerrainMesh.destroy();
      }
    };
  }, [helloTerrainMesh]);

  return (
    <group>
      <Html>
        <div className="flex flex-col items-center justify-center border-2 border-white rounded-md p-2 bg-black/50">
          <span className="text-white text-lg text-shadow-xl">TerrainMesh</span>
        </div>
      </Html>
      <hello.TerrainMesh
        receiveShadow
        castShadow
        frustumCulled={false}
        ref={(ref) => {
          if (!helloTerrainMesh) {
            setHelloTerrainMesh(ref);
          }
        }}
        args={[
          {
            innerTileSegments: terrainGeometryControls.segments,
            maxLevel: terrainGeometryControls.maxLevel,
            rootSize: terrainGeometryControls.rootSize,
            minNodeSize: terrainGeometryControls.minNodeSize,
            subdivisionFactor: terrainGeometryControls.subdivisionFactor,
            maxNodes: terrainGeometryControls.maxNodes,
          },
        ]}
      >
        <meshStandardNodeMaterial
          name="TerrainMeshMaterial"
          wireframe={terrainGeometryControls.wireframe}
          positionNode={positionNode}
          colorNode={colorNode}
        />
      </hello.TerrainMesh>
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

export default BasicComputeScene;
