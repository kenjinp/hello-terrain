"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { isSkirtUV, isSkirtVertex, TerrainGeometry } from "@hello-terrain/three";
import { Bounds, Html, OrbitControls, useTexture } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";

type LevaStore = ReturnType<typeof useCreateStore>;
import { useMemo } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  float,
  Fn,
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

extend(THREE as any);
extend({ TerrainGeometry });

const TerrainPlane = ({ store }: { store: LevaStore }) => {
  const terrainGeometryControls = useControls("TerrainGeometry", {
    segments: {
      value: 10,
      min: 2,
      max: 64,
      step: 2,
      label: "Segments",
    },
    skirtLength: {
      value: 1,
      min: 0,
      max: 5,
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
  }, { store });

  const uvMap = useTexture("/assets/uv-12x12.png");
  uvMap.wrapS = THREE.RepeatWrapping;
  uvMap.wrapT = THREE.RepeatWrapping;

  // Memoized varyings
  const uniforms = useMemo(() => {
    return {
      uWireframe: uniform(false).setName("uWireframe"),
      uPaintSkirts: uniform(false).setName("uPaintSkirts"),
      uSegments: uniform(terrainGeometryControls.segments).setName("uSegments"),
      uSkirtLength: uniform(terrainGeometryControls.skirtLength).setName("uSkirtLength"),
      uExtendUV: uniform(terrainGeometryControls.extendUv).setName("uExtendUV"),
    };
  }, []);

  // Memoized nodes
  const positionNode = useMemo(() => {
    return Fn(() => {
      const skirtLength = uniforms.uSkirtLength.toVar();
      const wp = positionLocal;
      const beforeTransform = select(
        isSkirtVertex(uniforms.uSegments),
        vec3(wp.x, wp.y.sub(float(skirtLength)), wp.z),
        wp,
      );
      return beforeTransform;
    })();
  }, [uniforms, isSkirtVertex]);

  const positionNodePlane = useMemo(() => {
    return Fn(() => {
      const vIndex = int(vertexIndex); // cast to i32 to match arithmetic
      // Edge length includes the duplicated outer ring for skirts: (segments + 1 + 2)
      const edge = int(uniforms.uSegments.add(3));
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
        vec3(afterScale.x, afterScale.y, afterScale.z.sub(uniforms.uSkirtLength.toVar())),
        afterScale,
      );
      return beforeTransform;
    })();
  }, [uniforms]);

  const colorNode = useMemo(() => {
    return Fn(() => {
      // Remap UV to match texture subdivisions (12) to current segments
      const textureSubdivisions = float(12).mul(
        select(
          uniforms.uExtendUV,
          float(uniforms.uSegments.div(uniforms.uSegments.add(2))),
          float(1),
        ),
      );
      const scale = uniforms.uSegments.toFloat().div(textureSubdivisions);
      const offset = float(1).sub(scale).div(2);
      const remappedUV = uv().mul(scale).add(offset);

      const color = select(
        uniforms.uPaintSkirts.and(isSkirtUV(uniforms.uSegments)),
        vec3(1, 0, 0),
        texture(uvMap, remappedUV),
      );
      return select(uniforms.uWireframe, vec3(1, 0, 0), color);
    })();
  }, [uvMap, uniforms]);

  useFrame(() => {
    uniforms.uWireframe.value = terrainGeometryControls.wireframe;
    uniforms.uPaintSkirts.value = terrainGeometryControls.paintSkirts;
    uniforms.uSegments.value = terrainGeometryControls.segments;
    uniforms.uSkirtLength.value = terrainGeometryControls.skirtLength;
    uniforms.uExtendUV.value = terrainGeometryControls.extendUv;
  });

  return (
    <>
      <group position={[0, 1, 0]}>
        <mesh position={[-0.6, 0, -0.6]}>
          <Html>
            <span>TerrainGeometry</span>
          </Html>
          <terrainGeometry
            args={[terrainGeometryControls.segments, terrainGeometryControls.extendUv]}
          />
          <meshStandardNodeMaterial
            wireframe={terrainGeometryControls.wireframe}
            positionNode={positionNode}
            colorNode={colorNode}
          />
        </mesh>
        <mesh position={[0.6, 0, -0.6]} rotation={[-Math.PI / 2, 0, 0]}>
          <Html>
            <span>PlaneGeometry</span>
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
    </>
  );
};

const TerrainGeometryScene = () => {
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
          near: 0.1,
          far: Number.MAX_SAFE_INTEGER,
          position: [0, 3, 1],
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.15} />
        <directionalLight intensity={1} position={[1, 1, 1]} />
        <Bounds fit observe>
          <TerrainPlane store={store} />
        </Bounds>
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
};

export default TerrainGeometryScene;
