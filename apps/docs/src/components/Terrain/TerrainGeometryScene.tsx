"use client";

import * as hello from "@hello-terrain/react";
import {
  Environment,
  Html,
  OrbitControls,
  useTexture,
} from "@react-three/drei";
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
  texture,
  uniform,
  uv,
  vec3,
  vertexIndex,
} from "three/tsl";
import * as THREE from "three/webgpu";

// biome-ignore lint/suspicious/noExplicitAny: <idk its recommended way from drei>
extend(THREE as any);

const TerrainPlane = () => {
  // const ref = useRef<ComponentRef<typeof hello.TerrainGeometry>>(null!);

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
    extendUv: {
      value: false,
      label: "Extend UV to skirts",
    },
    paintSkirts: {
      value: false,
      label: "Paint Skirts",
    },
  });

  const uvMap = useTexture("/assets/uv-12x12.png");

  // Memoized varyings
  const uniforms = useMemo(() => {
    return {
      uWireframe: uniform(false).setName("uWireframe"),
      uSkirtLength: uniform(0).setName("uSkirtLength"),
      uPaintSkirts: uniform(false).setName("uPaintSkirts"),
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

  const positionNodePlane = useMemo(() => {
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
      // Scale inner vertices outward so they align directly above the outer skirt ring.
      // Map inner extent [-0.5 + step, 0.5 - step] -> [-0.5, 0.5]
      const step = float(1).div(edge.sub(int(1)).toFloat());
      const scale = float(1).div(float(1).sub(step.mul(2.0)));
      const scaledInner = vec3(wp.x.mul(scale), wp.y.mul(scale), wp.z);

      const afterScale = select(isSkirtVertex, wp, scaledInner);
      const beforeTransform = select(
        isSkirtVertex,
        vec3(afterScale.x, afterScale.y, afterScale.z.sub(float(skirtLength))),
        afterScale
      );
      return beforeTransform;
    })();
  }, [terrainGeometryControls.segments, uniforms.uSkirtLength]);

  const colorNode = useMemo(() => {
    return Fn(() => {
      const ux = uv().x;
      const uy = uv().y;

      const segmentCount = terrainGeometryControls.segments + 2;
      const segmentStep = 1 / segmentCount;

      const innerX = ux
        .greaterThan(segmentStep)
        .and(ux.lessThan(1 - segmentStep));
      const innerY = uy
        .greaterThan(segmentStep)
        .and(uy.lessThan(1 - segmentStep));
      const isSkirtFragment = innerX.and(innerY).not();

      const color = select(
        uniforms.uPaintSkirts.and(isSkirtFragment),
        vec3(0, 0, 0),
        texture(uvMap, uv())
      );
      return select(uniforms.uWireframe, vec3(1, 0, 0), color);
    })();
  }, [uvMap, terrainGeometryControls.segments, uniforms]);

  useFrame(() => {
    uniforms.uSkirtLength.value = terrainGeometryControls.skirtLength;
    uniforms.uWireframe.value = terrainGeometryControls.wireframe;
    uniforms.uPaintSkirts.value = terrainGeometryControls.paintSkirts;
  });

  return (
    <group>
      <mesh position={[-0.5, 0, -0.5]}>
        <Html>
          <div className="flex flex-col items-center justify-center border-2 border-white rounded-md p-2 bg-black/50">
            <span className="text-white text-2xl text-shadow-xl">
              TerrainGeometry
            </span>
          </div>
        </Html>
        <hello.TerrainGeometry
          args={[
            terrainGeometryControls.segments,
            terrainGeometryControls.extendUv,
          ]}
        />
        <meshStandardNodeMaterial
          wireframe={terrainGeometryControls.wireframe}
          positionNode={positionNode}
          colorNode={colorNode}
        />
      </mesh>
      <mesh position={[0.5, 0, -0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <Html>
          <div className="flex flex-col items-center justify-center border-2 border-white rounded-md p-2 bg-black/50">
            <span className="text-white text-2xl text-shadow-xl">
              PlaneGeometry
            </span>
          </div>
        </Html>
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
          positionNode={positionNodePlane}
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

export default TerrainGeometryScene;
