"use client";

import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useMemo } from "react";
import { Fn } from "three/src/nodes/TSL.js";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  float,
  int,
  positionLocal,
  select,
  uniform,
  uv,
  vec3,
  vertexIndex,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { TerrainGeometry } from "./geometry/TerrainGeometry";

// biome-ignore lint/suspicious/noExplicitAny: <idk its recommended way from drei>
extend(THREE as any);
extend({ TerrainGeometry });

const TerrainPlane = () => {
  const terrainGeometryControls = useControls("TerrainGeometry", {
    segments: {
      value: 10,
      min: 2,
      max: 1024,
      step: 16,
      label: "Segments",
    },
    skirtLength: {
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      label: "Skirt Length",
    },
    wireframe: {
      value: false,
      label: "Wireframe",
    },
  });

  // Memoized varyings
  const uniforms = useMemo(() => {
    return {
      uSkirtLength: uniform(0).setName("uSkirtLength"),
    };
  }, []);

  // Memoized nodes
  const positionNode = useMemo(() => {
    return Fn(() => {
      const skirtLength = uniforms.uSkirtLength.toVar();
      const vIndex = vertexIndex; // built-in per-vertex index
      // Edge length includes the duplicated outer ring for skirts: (segments + 1 + 2)
      const edge = int(terrainGeometryControls.segments + 3);
      const vx = vIndex.mod(edge);
      const vy = vIndex.div(edge);
      const last = edge.sub(int(1));
      const isSkirtVertex = vx
        .equal(int(0))
        .or(vx.equal(last))
        .or(vy.equal(int(0)))
        .or(vy.equal(last));

      const wp = positionLocal;
      const beforeTransform = select(
        isSkirtVertex,
        vec3(wp.x, wp.y.sub(float(skirtLength)), wp.z),
        wp
      );
      return beforeTransform;
    })();
  }, [terrainGeometryControls.segments, uniforms.uSkirtLength]);

  const colorNode = useMemo(() => {
    return Fn(() => vec3(uv().x, 0, uv().y))();
  }, []);

  useFrame(() => {
    uniforms.uSkirtLength.value = terrainGeometryControls.skirtLength;
  });

  return (
    <group>
      <mesh position={[-0.5, 0, -0.5]}>
        {/* <planeGeometry
          args={[
            1,
            1,
            terrainGeometryControls.segments,
            terrainGeometryControls.segments,
          ]}
        /> */}
        <terrainGeometry args={[terrainGeometryControls.segments]} />
        <meshStandardNodeMaterial
          wireframe={terrainGeometryControls.wireframe}
          positionNode={positionNode}
          colorNode={colorNode}
        />
      </mesh>
      <mesh position={[0.5, 0, -0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry
          args={[
            1,
            1,
            terrainGeometryControls.segments + 2,
            terrainGeometryControls.segments + 2,
          ]}
        />
        <meshStandardNodeMaterial
          wireframe={terrainGeometryControls.wireframe}
          positionNode={positionNode}
          colorNode={colorNode}
        />
      </mesh>
    </group>
  );
};

const TerrainGeometryScene = () => {
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
      // biome-ignore lint/suspicious/noExplicitAny: <can't get it to work :p>
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
      <ambientLight intensity={2} />
      <OrbitControls />
      <TerrainPlane />
    </Canvas>
  );
};

export default TerrainGeometryScene;
