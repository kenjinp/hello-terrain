"use client";

import * as hello from "@hello-terrain/react";
import { TerrainUniforms, createIsSkirtVertex } from "@hello-terrain/three";
import {
  Environment,
  Html,
  OrbitControls,
  useTexture,
} from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useMemo, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
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
      value: true,
      label: "Extend UV to skirts",
    },
    paintSkirts: {
      value: false,
      label: "Paint Skirts",
    },
  });

  const uvMap = useTexture("/assets/uv-12x12.png");

  // Create instance-specific terrain uniforms
  const [terrainUniforms] = useState(
    () =>
      new TerrainUniforms({
        rootSize: 1,
        innerTileSegments: terrainGeometryControls.segments,
        skirtHeight: terrainGeometryControls.skirtLength,
      })
  );

  // Memoized varyings
  const uniforms = useMemo(() => {
    return {
      uWireframe: uniform(false).setName("uWireframe"),
      uPaintSkirts: uniform(false).setName("uPaintSkirts"),
    };
  }, []);

  // Create instance-specific skirt detection functions
  const isSkirtVertex = useMemo(
    () => createIsSkirtVertex(terrainUniforms),
    [terrainUniforms]
  );

  // Memoized nodes
  const positionNode = useMemo(() => {
    return Fn(() => {
      const skirtLength = terrainUniforms.uSkirtHeight.toVar();

      const wp = positionLocal;
      const beforeTransform = select(
        isSkirtVertex(),
        vec3(wp.x, wp.y.sub(float(skirtLength)), wp.z),
        wp
      );
      return beforeTransform;
    })();
  }, [terrainUniforms, isSkirtVertex]);

  const positionNodePlane = useMemo(() => {
    return Fn(() => {
      const vIndex = int(vertexIndex); // cast to i32 to match arithmetic
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
        vec3(
          afterScale.x,
          afterScale.y,
          afterScale.z.sub(terrainUniforms.uSkirtHeight.toVar())
        ),
        afterScale
      );
      return beforeTransform;
    })();
  }, [terrainGeometryControls.segments, terrainUniforms]);

  const colorNode = useMemo(() => {
    return Fn(() => {
      // Inline skirt fragment detection to ensure uniforms are directly referenced
      const ux = uv().x;
      const uy = uv().y;
      const segments = terrainUniforms.uSegments.toVar();
      const segmentCount = segments.add(2);
      const segmentStep = float(1).div(segmentCount);
      const innerX = ux
        .greaterThan(segmentStep)
        .and(ux.lessThan(segmentStep.oneMinus()));
      const innerY = uy
        .greaterThan(segmentStep)
        .and(uy.lessThan(segmentStep.oneMinus()));
      const isSkirtFrag = innerX.and(innerY).not();

      const color = select(
        uniforms.uPaintSkirts.and(isSkirtFrag),
        vec3(0, 0, 0),
        texture(uvMap, uv())
      );
      return select(uniforms.uWireframe, vec3(1, 0, 0), color);
    })();
  }, [uvMap, uniforms, terrainUniforms]);

  useFrame(() => {
    terrainUniforms.uSegments.value = terrainGeometryControls.segments;
    terrainUniforms.uSkirtHeight.value = terrainGeometryControls.skirtLength;
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
