"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import { voronoiCells } from "@/components/Terrain/lib/TSLNodes/Voronoi";
import * as hello from "@hello-terrain/react";
import { ElevationFn, type TerrainMesh } from "@hello-terrain/three";
import { Environment } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  float,
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

// Character controller constants
const CHARACTER_HEIGHT = 1.8;
const CHARACTER_RADIUS = 0.4;
const MOVE_SPEED = 15;
const CAMERA_DISTANCE = 8;
const CAMERA_HEIGHT = 4;
const CAMERA_SMOOTHING = 0.08;

// Input state for keyboard controls
type InputState = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
};

// Hook to handle keyboard input
function useKeyboardInput(): InputState {
  const [input, setInput] = useState<InputState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          setInput((prev) => ({ ...prev, forward: true }));
          break;
        case "KeyS":
        case "ArrowDown":
          setInput((prev) => ({ ...prev, backward: true }));
          break;
        case "KeyA":
        case "ArrowLeft":
          setInput((prev) => ({ ...prev, left: true }));
          break;
        case "KeyD":
        case "ArrowRight":
          setInput((prev) => ({ ...prev, right: true }));
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          setInput((prev) => ({ ...prev, forward: false }));
          break;
        case "KeyS":
        case "ArrowDown":
          setInput((prev) => ({ ...prev, backward: false }));
          break;
        case "KeyA":
        case "ArrowLeft":
          setInput((prev) => ({ ...prev, left: false }));
          break;
        case "KeyD":
        case "ArrowRight":
          setInput((prev) => ({ ...prev, right: false }));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return input;
}

// Character capsule component
const Character = ({
  position,
}: {
  position: THREE.Vector3;
}) => {
  const capsuleRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (capsuleRef.current) {
      // Position the capsule so its bottom is at the terrain surface
      capsuleRef.current.position.copy(position);
      capsuleRef.current.position.y += CHARACTER_HEIGHT / 2 + CHARACTER_RADIUS;
    }
  });

  return (
    <mesh ref={capsuleRef} castShadow>
      <capsuleGeometry
        args={[
          CHARACTER_RADIUS,
          CHARACTER_HEIGHT - CHARACTER_RADIUS * 2,
          8,
          16,
        ]}
      />
      <meshStandardMaterial color="#e74c3c" roughness={0.4} metalness={0.3} />
    </mesh>
  );
};

// Third person camera controller
const ThirdPersonCamera = ({
  targetPosition,
  characterRotation,
}: {
  targetPosition: THREE.Vector3;
  characterRotation: number;
}) => {
  const { camera } = useThree();
  const currentCameraPos = useRef(new THREE.Vector3());
  const currentLookAt = useRef(new THREE.Vector3());

  useFrame(() => {
    // Calculate desired camera position behind and above the character
    const desiredCameraPos = new THREE.Vector3(
      targetPosition.x - Math.sin(characterRotation) * CAMERA_DISTANCE,
      targetPosition.y + CAMERA_HEIGHT,
      targetPosition.z - Math.cos(characterRotation) * CAMERA_DISTANCE
    );

    // Smoothly interpolate camera position
    currentCameraPos.current.lerp(desiredCameraPos, CAMERA_SMOOTHING);
    camera.position.copy(currentCameraPos.current);

    // Look at point slightly above the character
    const lookAtTarget = new THREE.Vector3(
      targetPosition.x,
      targetPosition.y + CHARACTER_HEIGHT,
      targetPosition.z
    );
    currentLookAt.current.lerp(lookAtTarget, CAMERA_SMOOTHING);
    camera.lookAt(currentLookAt.current);
  });

  return null;
};

const TerrainWithCharacter = () => {
  const { camera, gl } = useThree();
  const [helloTerrainMesh, setHelloTerrainMesh] = useState<TerrainMesh | null>(
    null
  );

  // Character state
  const characterPosition = useRef(new THREE.Vector3(0, 0, 0));
  const characterRotation = useRef(0);
  const [characterPosState, setCharacterPosState] = useState(
    new THREE.Vector3(0, 0, 0)
  );
  const [characterRotState, setCharacterRotState] = useState(0);

  const input = useKeyboardInput();

  const setMetric = useMetrics([
    "characterPosition",
    "terrainHeight",
    "heightQueryTime",
    "hasValidData",
    "nodeCount",
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
      value: 50,
      min: 0.0,
      max: 200.0,
      step: 0.1,
      label: "Heightmap Scale",
    },
    noiseScale: {
      value: 0.008,
      min: 0.001,
      max: 0.1,
      step: 0.0001,
      label: "Noise Scale",
    },
  });

  const characterControls = useControls("Character", {
    moveSpeed: {
      value: MOVE_SPEED,
      min: 1,
      max: 50,
      step: 1,
      label: "Move Speed",
    },
    cameraDistance: {
      value: CAMERA_DISTANCE,
      min: 2,
      max: 20,
      step: 0.5,
      label: "Camera Distance",
    },
    cameraHeight: {
      value: CAMERA_HEIGHT,
      min: 1,
      max: 15,
      step: 0.5,
      label: "Camera Height",
    },
  });

  const elevationUniforms = useMemo(() => {
    return {
      uHeightmapScale: uniform(50.0).setName("uHeightmapScale"),
      uNoiseScale: uniform(0.008).setName("uNoiseScale"),
    };
  }, []);

  const colorNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return Fn(() => {
      return helloTerrainMesh.varyings.vNormal.toColor();
    })();
  }, [helloTerrainMesh]);

  // Track last known good height and smoothing
  const lastValidHeight = useRef(0);
  const smoothedHeight = useRef(0);
  const frameCount = useRef(0);

  // Character movement and height query
  useFrame((_, delta) => {
    frameCount.current++;

    // Update elevation uniforms from controls
    elevationUniforms.uHeightmapScale.value =
      terrainGeometryControls.heightmapScale;
    elevationUniforms.uNoiseScale.value = terrainGeometryControls.noiseScale;

    // Handle character movement (XZ only, height is set by terrain)
    const moveDir = new THREE.Vector3();
    if (input.forward) moveDir.z += 1;
    if (input.backward) moveDir.z -= 1;
    if (input.left) moveDir.x += 1;
    if (input.right) moveDir.x -= 1;

    if (moveDir.length() > 0) {
      moveDir.normalize();

      // Rotate movement direction based on character rotation
      const rotatedDir = new THREE.Vector3(
        moveDir.x * Math.cos(characterRotation.current) -
          moveDir.z * Math.sin(characterRotation.current),
        0,
        moveDir.x * Math.sin(characterRotation.current) +
          moveDir.z * Math.cos(characterRotation.current)
      );

      // Update character rotation to face movement direction
      characterRotation.current = Math.atan2(rotatedDir.x, rotatedDir.z);

      // Move character
      const speed = characterControls.moveSpeed * delta;
      characterPosition.current.x += rotatedDir.x * speed;
      characterPosition.current.z += rotatedDir.z * speed;
    }

    if (helloTerrainMesh) {
      // Update terrain uniforms
      helloTerrainMesh.uniforms.uSegments.value =
        terrainGeometryControls.segments;
      helloTerrainMesh.uniforms.setHeightmapScale(
        terrainGeometryControls.heightmapScale
      );

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

      // Update terrain - this triggers GPU compute and async readback
      helloTerrainMesh.update(
        gl as unknown as THREE.WebGPURenderer,
        characterPosition.current,
        frustum
      );

      // Query terrain height
      const beforeQuery = performance.now();
      const terrainHeight = helloTerrainMesh.queryHeightAtPosition(
        characterPosition.current
      );
      const afterQuery = performance.now();

      // Check if we have valid height data
      const hasValidData = (
        helloTerrainMesh as unknown as { hasValidHeightData: boolean }
      ).hasValidHeightData;

      // Determine target height
      let targetHeight = smoothedHeight.current;
      if (terrainHeight !== null && terrainHeight !== 0 && hasValidData) {
        targetHeight = terrainHeight;
        lastValidHeight.current = terrainHeight;
        setMetric("terrainHeight", `${terrainHeight.toFixed(2)} (live)`);
      } else if (lastValidHeight.current !== 0) {
        targetHeight = lastValidHeight.current;
        setMetric(
          "terrainHeight",
          `${lastValidHeight.current.toFixed(2)} (cached)`
        );
      } else {
        // Wait for data on initial frames
        setMetric("terrainHeight", `frame ${frameCount.current} - waiting...`);
      }

      // Smooth the height to prevent jerking
      const smoothingFactor = 0.3; // Adjust for more/less smoothing
      smoothedHeight.current +=
        (targetHeight - smoothedHeight.current) * smoothingFactor;
      characterPosition.current.y = smoothedHeight.current;

      setMetric(
        "heightQueryTime",
        `${(afterQuery - beforeQuery).toFixed(3)}ms`
      );
      setMetric("hasValidData", hasValidData ? "yes" : "no");
      setMetric(
        "nodeCount",
        `${helloTerrainMesh.metrics.leafNodeCount} / ${helloTerrainMesh.metrics.nodeCount}`
      );
      setMetric(
        "updateTime",
        (helloTerrainMesh.metrics.updateTime ?? "").toString()
      );
    }

    setMetric(
      "characterPosition",
      `${characterPosition.current.x.toFixed(1)}, ${characterPosition.current.y.toFixed(1)}, ${characterPosition.current.z.toFixed(1)}`
    );

    // Update React state for child components
    setCharacterPosState(characterPosition.current.clone());
    setCharacterRotState(characterRotation.current);
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
            positionNode={positionNode}
            colorNode={colorNode}
            normalNode={normalNode}
          />
        </hello.TerrainMesh>
      </group>

      <Character position={characterPosState} />

      <ThirdPersonCamera
        targetPosition={characterPosState}
        characterRotation={characterRotState}
      />
    </>
  );
};

// Instructions overlay component
const Instructions = () => {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: 20,
        padding: "16px 20px",
        background: "rgba(0, 0, 0, 0.75)",
        borderRadius: "12px",
        color: "white",
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace",
        fontSize: "13px",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        maxWidth: "280px",
      }}
    >
      <div
        style={{
          fontWeight: 600,
          marginBottom: "10px",
          fontSize: "14px",
          color: "#e74c3c",
        }}
      >
        Character Controls
      </div>
      <div style={{ display: "grid", gap: "6px" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "4px 8px",
              borderRadius: "4px",
              minWidth: "28px",
              textAlign: "center",
            }}
          >
            W
          </kbd>
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "4px 8px",
              borderRadius: "4px",
              minWidth: "28px",
              textAlign: "center",
            }}
          >
            ↑
          </kbd>
          <span style={{ opacity: 0.8 }}>Move Forward</span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "4px 8px",
              borderRadius: "4px",
              minWidth: "28px",
              textAlign: "center",
            }}
          >
            S
          </kbd>
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "4px 8px",
              borderRadius: "4px",
              minWidth: "28px",
              textAlign: "center",
            }}
          >
            ↓
          </kbd>
          <span style={{ opacity: 0.8 }}>Move Backward</span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "4px 8px",
              borderRadius: "4px",
              minWidth: "28px",
              textAlign: "center",
            }}
          >
            A
          </kbd>
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "4px 8px",
              borderRadius: "4px",
              minWidth: "28px",
              textAlign: "center",
            }}
          >
            ←
          </kbd>
          <span style={{ opacity: 0.8 }}>Move Left</span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "4px 8px",
              borderRadius: "4px",
              minWidth: "28px",
              textAlign: "center",
            }}
          >
            D
          </kbd>
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "4px 8px",
              borderRadius: "4px",
              minWidth: "28px",
              textAlign: "center",
            }}
          >
            →
          </kbd>
          <span style={{ opacity: 0.8 }}>Move Right</span>
        </div>
      </div>
    </div>
  );
};

const CharacterControllerScene = () => {
  return (
    <>
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
            maxComputeWorkgroupsPerDimension: 65535,
            maxComputeWorkgroupSizeX: 1024,
            maxComputeWorkgroupSizeY: 1024,
            maxComputeWorkgroupSizeZ: 64,
          };
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
          position: [0, 10, -10],
          fov: 60,
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <color attach="background" args={["#1a1a2e"]} />
        <Environment
          preset="sunset"
          background={false}
          environmentIntensity={0.8}
        />
        <ambientLight intensity={0.3} />
        <directionalLight
          intensity={1.5}
          position={[50, 100, 50]}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={500}
          shadow-camera-left={-100}
          shadow-camera-right={100}
          shadow-camera-top={100}
          shadow-camera-bottom={-100}
        />
        <fog attach="fog" args={["#1a1a2e", 100, 800]} />
        <TerrainWithCharacter />
      </Canvas>
      <Instructions />
    </>
  );
};

export default CharacterControllerScene;
