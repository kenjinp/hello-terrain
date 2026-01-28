"use client";

import {
  deriveNormalZ,
  textureSpaceToVectorSpace,
  vectorSpaceToTextureSpace,
} from "@hello-terrain/three";
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useRef, useState } from "react";
import { LoadingBar } from "@/components/LoadingBar/LoadingBar";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import { Fn, normalLocal, normalMap, positionLocal, texture, uv, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { Mesh } from "three/webgpu";

type DebugView = "complete" | "albedo" | "ao" | "roughness" | "height" | "normals";

const DEBUG_VIEW_OPTIONS: { value: DebugView; label: string }[] = [
  { value: "complete", label: "Complete" },
  { value: "albedo", label: "Albedo" },
  { value: "ao", label: "Ambient Occlusion" },
  { value: "roughness", label: "Roughness" },
  { value: "height", label: "Height" },
  { value: "normals", label: "Normals" },
];

extend(THREE as any);

const SPHERES = [
  {
    id: "rocky_ground",
    label: "Rocky Ground",
    albedoMap: "/assets/materials/ground-rocky/ground_rocky_albedo.ktx2",
    normalMap: "/assets/materials/ground-rocky/ground_rocky_normal.ktx2",
    aorhMap: "/assets/materials/ground-rocky/ground_rocky_aorh.ktx2",
  },
  {
    id: "cliff",
    label: "Cliff",
    albedoMap: "/assets/materials/cliff/cliff_albedo.ktx2",
    normalMap: "/assets/materials/cliff/cliff_normal.ktx2",
    aorhMap: "/assets/materials/cliff/cliff_aorh.ktx2",
  },
] as const;

interface SphereProps {
  id: string;
  position: [number, number, number];
  isRotating: boolean;
  textures: {
    albedo: string;
    normal: string;
    aorh: string;
  };
  debugView: DebugView;
  heightEnabled: boolean;
}

const MaterialSphere = ({ id, position, isRotating, textures, debugView, heightEnabled }: SphereProps) => {
  const { gl } = useThree();
  const meshRef = useRef<Mesh | null>(null);

  // Load KTX2 textures using the pre-configured loader
  const [albedo, normal, aorh] = useLoader(
    KTX2Loader,
    [textures.albedo, textures.normal, textures.aorh],
    async (loader) => {
      loader.setTranscoderPath(
        "https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/basis/",
      );
      loader.detectSupport(gl);
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const hasBCCompression = adapter.features.has("texture-compression-bc");
        if (!hasBCCompression) {
          alert("Your device is not supported (no BCn compression)");
        }
      }
    },
  );
  normal.colorSpace = THREE.LinearSRGBColorSpace;

  // Create texture nodes for sampling
  const albedoTex = texture(albedo);
  const normalTex = texture(normal);
  const aorhTex = texture(aorh);

  const normalNode = Fn(() => {
    // BC5 normal maps store X,Y in RG channels. Reconstruct Z from the unit sphere.
    // Remap from [0,1] to [-1,1]
    const rg = normalTex.rg;
    const xy = textureSpaceToVectorSpace(rg);

    // Reconstruct Z: z = sqrt(1 - x² - y²)
    const reconstructedNormal = deriveNormalZ(xy);
    return normalMap(vectorSpaceToTextureSpace(reconstructedNormal), vec2(1, 1));
  })();

  // Reconstructed normal as color for debug view (map -1,1 to 0,1)
  const normalsColorNode = Fn(() => {
    const rg = normalTex.rg;
    const xy = textureSpaceToVectorSpace(rg);
    const reconstructedNormal = deriveNormalZ(xy);
    // Map from [-1,1] to [0,1] for visualization
    return vectorSpaceToTextureSpace(reconstructedNormal);
  })();

  const aoNode = Fn(() => {
    // Sample ambient occlusion from the R channel of the aorh texture
    // Remap from [0,1] to [-1,1]
    const blah = textureSpaceToVectorSpace(aorhTex.r).negate();
    return blah;
  })();

  // AO as grayscale color for debug view
  const aoColorNode = Fn(() => {
    const ao = aorhTex.r;
    return vec3(ao, ao, ao);
  })();

  const roughnessNode = Fn(() => {
    // Sample roughness from the G channel of the aorh texture
    // Remap from [0,1] to [-1,1]
    const blah = textureSpaceToVectorSpace(aorhTex.g).negate();
    return blah;
  })();

  // Roughness as grayscale color for debug view
  const roughnessColorNode = Fn(() => {
    const roughness = aorhTex.g;
    return vec3(roughness, roughness, roughness);
  })();

  // Height as grayscale color for debug view
  const heightColorNode = Fn(() => {
    const height = aorhTex.b;
    return vec3(height, height, height);
  })();

  const positionNode = Fn(() => {
    // Displace vertices along the normal using height from the B channel
    const height = texture(aorh, uv()).b;
    const scale = heightEnabled ? 1.0 : 0.0;
    const displacement = normalLocal.mul(height.mul(scale)); // Scale factor for displacement
    return positionLocal.add(displacement);
  })();

  // Get the appropriate color node based on debug view
  const getDebugColorNode = () => {
    switch (debugView) {
      case "albedo":
        return albedoTex;
      case "ao":
        return aoColorNode;
      case "roughness":
        return roughnessColorNode;
      case "height":
        return heightColorNode;
      case "normals":
        return normalsColorNode;
      default:
        return null;
    }
  };

  useFrame(() => {
    if (meshRef.current && isRotating) {
      meshRef.current.rotation.y += 0.0006;
    }
  });

  const debugColorNode = getDebugColorNode();

  if (debugView === "complete") {
    return (
      <mesh key={`${id}-${debugView}-${heightEnabled ? "height" : "no-height"}`} ref={meshRef} position={position} receiveShadow>
        <sphereGeometry args={[0.8, 64, 64]} />
        <meshStandardNodeMaterial
          key={`${id}-${debugView}`}
          map={albedo}
          normalNode={normalNode}
          roughnessNode={roughnessNode}
          aoNode={aoNode}
          positionNode={positionNode}
          metalness={0}
        />
      </mesh>
    );
  }

  return (
    <mesh key={`${id}-${debugView}-${heightEnabled ? "height" : "no-height"}`}  ref={meshRef} position={position}>
      <sphereGeometry args={[0.8, 64, 64]} />
      <meshBasicNodeMaterial
        key={`${id}-${debugView}`}
        colorNode={debugColorNode}
        positionNode={positionNode}
      />
    </mesh>
  );
};

interface CameraControllerProps {
  targetPosition: [number, number, number];
  controlsRef: React.RefObject<React.ComponentRef<typeof OrbitControls> | null>;
}

const CameraController = ({ targetPosition, controlsRef }: CameraControllerProps) => {
  const targetVec = useRef(new THREE.Vector3());
  const prevTarget = useRef<[number, number, number] | null>(null);
  const isAnimating = useRef(false);

  useFrame(() => {
    if (!controlsRef.current) return;

    const controls = controlsRef.current as unknown as { target: THREE.Vector3 };

    // Detect target change
    if (
      !prevTarget.current ||
      prevTarget.current[0] !== targetPosition[0] ||
      prevTarget.current[1] !== targetPosition[1] ||
      prevTarget.current[2] !== targetPosition[2]
    ) {
      prevTarget.current = [...targetPosition];
      isAnimating.current = true;
    }

    // Only animate the OrbitControls target, not the camera position
    if (isAnimating.current) {
      targetVec.current.set(...targetPosition);
      controls.target.lerp(targetVec.current, 0.08);

      // Stop animating when close enough
      if (controls.target.distanceTo(targetVec.current) < 0.01) {
        controls.target.copy(targetVec.current);
        isAnimating.current = false;
      }
    }
  });

  return null;
};

interface SceneProps {
  focusedSphere: string | null;
  controlsRef: React.RefObject<React.ComponentRef<typeof OrbitControls> | null>;
  isRotating: boolean;
  debugView: DebugView;
  heightEnabled: boolean;
}

const Scene = ({ focusedSphere, controlsRef, isRotating, debugView, heightEnabled }: SceneProps) => {
  const spacing = 3;
  const totalWidth = (SPHERES.length - 1) * spacing;
  const startX = -totalWidth / 2;

  const getPosition = (index: number): [number, number, number] => [startX + index * spacing, 0, 0];

  const targetPosition =
    SPHERES.findIndex((s) => s.id === focusedSphere) >= 0
      ? getPosition(SPHERES.findIndex((s) => s.id === focusedSphere))
      : ([0, 0, 0] as [number, number, number]);

  return (
    <>
      <directionalLight position={[5, 5, 5]} intensity={5} castShadow  />

      {SPHERES.map((sphere, index) => (
        <MaterialSphere
          key={sphere.id}
          id={sphere.id}
          position={getPosition(index)}
          isRotating={isRotating}
          debugView={debugView}
          heightEnabled={heightEnabled}
          textures={{
            albedo: sphere.albedoMap,
            normal: sphere.normalMap,
            aorh: sphere.aorhMap,
          }}
        />
      ))}

      <CameraController targetPosition={targetPosition} controlsRef={controlsRef} />
    </>
  );
};

const MaterialsBCNScene = () => {
  const [focusedSphere, setFocusedSphere] = useState<string | null>(null);
  const [isRotating, setIsRotating] = useState(true);
  const [debugView, setDebugView] = useState<DebugView>("complete");
  const [heightEnabled, setHeightEnabled] = useState(true);
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls> | null>(null);

  const stopRotation = () => setIsRotating(false);
  const resumeRotation = () => setIsRotating(true);

  return (
    <div
      className="relative w-full h-full rounded overflow-hidden backdrop-blur-sm"
      onMouseDown={stopRotation}
      onMouseUp={resumeRotation}
      onMouseLeave={resumeRotation}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          stopRotation();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          resumeRotation();
        }
      }}
      tabIndex={0}
    >
      <LoadingBar />
      <Canvas
        style={{
          position: "relative",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
        shadows
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(props as WebGPURendererParameters);

          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          renderer.shadowMap.enabled = true;

          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 0.1,
          far: 1000,
          position: [0, 2, 8],
          fov: 50,
        }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene
            focusedSphere={focusedSphere}
            controlsRef={controlsRef}
            isRotating={isRotating}
            debugView={debugView}
            heightEnabled={heightEnabled}
          />
        </Suspense>
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enablePan={false}
          minDistance={1.5}
          maxDistance={15}
        />
        <Environment preset="forest" background />
      </Canvas>

      {/* Debug View Panel */}
      <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md rounded-lg p-3 border border-white/10">
        <div className="text-xs font-medium text-white/70 uppercase tracking-wider mb-2">
          Material View
        </div>
        <div className="flex flex-col gap-1">
          {DEBUG_VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setDebugView(option.value)}
              className={`px-3 py-1.5 text-sm rounded transition-all text-left ${
                debugView === option.value
                  ? "bg-white text-black font-medium"
                  : "text-white/80 hover:bg-white/10"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="border-t border-white/10 mt-3 pt-3">
          <button
            onClick={() => setHeightEnabled(!heightEnabled)}
            className={`w-full px-3 py-1.5 text-sm rounded transition-all text-left ${
              heightEnabled
                ? "bg-white text-black font-medium"
                : "text-white/80 hover:bg-white/10"
            }`}
          >
            Height Displacement
          </button>
        </div>
      </div>

      {/* Bottom button bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {SPHERES.map((sphere) => (
          <button
            key={sphere.id}
            onClick={() => setFocusedSphere(focusedSphere === sphere.id ? null : sphere.id)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              focusedSphere === sphere.id
                ? "bg-white text-black shadow-lg scale-105"
                : "bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm"
            }`}
          >
            {sphere.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default MaterialsBCNScene;
