"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import { voronoiCells } from "@/components/Terrain/lib/TSLNodes/Voronoi";
import * as hello from "@hello-terrain/react";
import { ElevationFn, type TerrainMesh } from "@hello-terrain/three";
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { HeightfieldCollider, Physics, RigidBody } from "@react-three/rapier";
import { button, useControls } from "leva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Heightfield resolution for physics collision
const HEIGHTFIELD_RESOLUTION = 64;

// Physics object types
type PhysicsObjectType = "sphere" | "cube";

interface PhysicsObject {
  id: string;
  type: PhysicsObjectType;
  position: [number, number, number];
  color: string;
}

// Generate a random color
const randomColor = () => {
  const colors = [
    "#e74c3c",
    "#3498db",
    "#2ecc71",
    "#f39c12",
    "#9b59b6",
    "#1abc9c",
    "#e67e22",
    "#34495e",
    "#16a085",
    "#c0392b",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

// Debug wireframe mesh to visualize the heightfield collider
const HeightfieldDebugMesh = ({
  heights,
  resolution,
  size,
  visible,
}: {
  heights: Float32Array | null;
  resolution: number;
  size: number;
  visible: boolean;
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!meshRef.current || !heights || !visible) return;

    const geometry = meshRef.current.geometry as THREE.PlaneGeometry;
    const positionAttr = geometry.getAttribute("position");

    // Update vertex positions with heightfield data
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const vertexIndex = z * resolution + x;
        const height = heights[z * resolution + x];

        // PlaneGeometry is created with segments = resolution - 1
        // and is centered, so we need to match vertex indices
        if (vertexIndex < positionAttr.count) {
          positionAttr.setZ(vertexIndex, height);
        }
      }
    }

    positionAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  }, [heights, resolution, visible]);

  if (!visible || !heights) return null;

  return (
    <mesh
      key={`${size}-${resolution}`}
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.5, 0]}
    >
      <planeGeometry args={[size, size, resolution - 1, resolution - 1]} />
      <meshBasicMaterial color="#ff00ff" wireframe transparent opacity={0.8} />
    </mesh>
  );
};

// Terrain heightfield collider - built directly from TerrainMesh height data
const TerrainCollider = ({
  terrainMesh,
  size,
  onReady,
  onHeightsUpdate,
  showDebug,
}: {
  terrainMesh: TerrainMesh | null;
  size: number;
  onReady: (ready: boolean) => void;
  onHeightsUpdate: (heights: Float32Array | null) => void;
  showDebug: boolean;
}) => {
  const [heights, setHeights] = useState<Float32Array | null>(null);
  const [currentSize, setCurrentSize] = useState(size);
  const lastSampleTime = useRef(0);

  // Use the terrain's built-in heightfield extraction
  useFrame(() => {
    if (!terrainMesh) return;

    // Only rebuild heightfield every 500ms to avoid performance issues
    const now = performance.now();
    if (now - lastSampleTime.current < 500 && heights !== null) return;
    lastSampleTime.current = now;

    // Use the terrain's efficient heightfield grid extraction
    // Cast needed until types are rebuilt
    const newHeights = (
      terrainMesh as unknown as {
        getHeightfieldGrid: (
          resolution: number,
          size: number
        ) => Float32Array | null;
      }
    ).getHeightfieldGrid(HEIGHTFIELD_RESOLUTION, size);

    if (newHeights) {
      // Log some debug info
      const minH = Math.min(...newHeights);
      const maxH = Math.max(...newHeights);
      console.log(
        `Heightfield: min=${minH.toFixed(2)}, max=${maxH.toFixed(2)}, size=${size}`
      );

      setHeights(newHeights);
      setCurrentSize(size);
      onHeightsUpdate(newHeights);
      onReady(true);
    }
  });

  if (!heights) return null;

  // Convert Float32Array to number[] for Rapier
  const heightsArray = Array.from(heights);

  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
        <HeightfieldCollider
          args={[
            HEIGHTFIELD_RESOLUTION - 1,
            HEIGHTFIELD_RESOLUTION - 1,
            heightsArray,
            { x: currentSize, y: 1, z: currentSize },
          ]}
          restitution={0.2}
          friction={0.8}
        />
      </RigidBody>

      {/* Debug visualization */}
      <HeightfieldDebugMesh
        heights={heights}
        resolution={HEIGHTFIELD_RESOLUTION}
        size={currentSize}
        visible={showDebug}
      />
    </>
  );
};

// Simple physics sphere (Rapier handles collision with heightfield)
const PhysicsSphere = ({
  position,
  color,
}: {
  position: [number, number, number];
  color: string;
}) => {
  return (
    <RigidBody
      position={position}
      colliders="ball"
      restitution={0.4}
      friction={0.5}
    >
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
      </mesh>
    </RigidBody>
  );
};

// Simple physics cube (Rapier handles collision with heightfield)
const PhysicsCube = ({
  position,
  color,
}: {
  position: [number, number, number];
  color: string;
}) => {
  return (
    <RigidBody
      position={position}
      colliders="cuboid"
      restitution={0.2}
      friction={0.6}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
      </mesh>
    </RigidBody>
  );
};

// Draggable spawn point marker (WebGPU compatible - uses pointer drag)
const SpawnPointMarker = ({
  position,
  onPositionChange,
}: {
  position: [number, number, number];
  onPositionChange: (x: number, z: number) => void;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const { camera, gl } = useThree();
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const raycaster = useRef(new THREE.Raycaster());
  const pointer = useRef(new THREE.Vector2());

  // Animate the marker
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime;
      meshRef.current.position.y =
        position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.5;
    }
  });

  // Handle pointer move during drag
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera(pointer.current, camera);
      const intersectPoint = new THREE.Vector3();
      raycaster.current.ray.intersectPlane(planeRef.current, intersectPoint);

      if (intersectPoint) {
        onPositionChange(intersectPoint.x, intersectPoint.z);
      }
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      gl.domElement.style.cursor = isHovered ? "grab" : "auto";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDragging, camera, gl, onPositionChange, isHovered]);

  return (
    <group ref={groupRef} position={[position[0], 0, position[2]]}>
      {/* Vertical beam */}
      <mesh position={[0, position[1] / 2, 0]}>
        <cylinderGeometry args={[0.1, 0.1, position[1], 8]} />
        <meshStandardMaterial color="#00ff88" transparent opacity={0.3} />
      </mesh>
      {/* Draggable marker */}
      <mesh
        ref={meshRef}
        position={[0, position[1], 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          setIsDragging(true);
          gl.domElement.style.cursor = "grabbing";
        }}
        onPointerOver={() => {
          setIsHovered(true);
          if (!isDragging) gl.domElement.style.cursor = "grab";
        }}
        onPointerOut={() => {
          setIsHovered(false);
          if (!isDragging) gl.domElement.style.cursor = "auto";
        }}
      >
        <octahedronGeometry args={[2.5, 0]} />
        <meshStandardMaterial
          color={isDragging ? "#ffff00" : isHovered ? "#88ffbb" : "#00ff88"}
          emissive={isDragging ? "#ffff00" : "#00ff88"}
          emissiveIntensity={isDragging ? 1.2 : 0.8}
        />
      </mesh>
      {/* Ground ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[2, 3, 32]} />
        <meshStandardMaterial
          color={isDragging ? "#ffff00" : "#00ff88"}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

// Main terrain scene with physics
const TerrainWithPhysics = () => {
  const { camera, gl } = useThree();
  const [helloTerrainMesh, setHelloTerrainMesh] = useState<TerrainMesh | null>(
    null
  );
  const [physicsObjects, setPhysicsObjects] = useState<PhysicsObject[]>([]);
  const [colliderReady, setColliderReady] = useState(false);
  const [debugHeights, setDebugHeights] = useState<Float32Array | null>(null);
  const objectIdCounter = useRef(0);

  const setMetric = useMetrics([
    "objectCount",
    "spawnPoint",
    "terrainReady",
    "colliderReady",
    "heightRange",
    "nodeCount",
  ] as const);

  const terrainControls = useControls("Terrain", {
    segments: { value: SEGMENT_COUNT, min: 8, max: 128, step: 4 },
    wireframe: { value: false },
    maxLevel: { value: 8, min: 1, max: 10, step: 1 },
    rootSize: { value: 200, min: 50, max: 500, step: 10 },
    heightmapScale: { value: 8, min: 1, max: 100, step: 1 },
    noiseScale: { value: 0.015, min: 0.001, max: 0.1, step: 0.001 },
  });

  const debugControls = useControls("Debug", {
    showCollider: { value: true, label: "Show Collider Wireframe" },
  });

  const [spawnControls, setSpawnControls] = useControls("Spawn Point", () => ({
    x: { value: 0, min: -100, max: 100, step: 1 },
    z: { value: 0, min: -100, max: 100, step: 1 },
    height: { value: 80, min: 10, max: 200, step: 5 },
    radius: { value: 10, min: 1, max: 50, step: 1 },
  }));

  useControls("Physics", {
    spawnSpheres: button(() => spawnObjects("sphere", 10)),
    spawnCubes: button(() => spawnObjects("cube", 10)),
    spawnMixed: button(() => {
      spawnObjects("sphere", 5);
      spawnObjects("cube", 5);
    }),
    spawn100: button(() => {
      spawnObjects("sphere", 50);
      spawnObjects("cube", 50);
    }),
    clearAll: button(() => setPhysicsObjects([])),
  });

  // Spawn physics objects
  const spawnObjects = useCallback(
    (type: PhysicsObjectType, count: number) => {
      const newObjects: PhysicsObject[] = [];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * spawnControls.radius;
        const offsetX = Math.cos(angle) * radius;
        const offsetZ = Math.sin(angle) * radius;

        newObjects.push({
          id: `obj-${objectIdCounter.current++}`,
          type,
          position: [
            spawnControls.x + offsetX,
            spawnControls.height + Math.random() * 20,
            spawnControls.z + offsetZ,
          ],
          color: randomColor(),
        });
      }
      setPhysicsObjects((prev) => [...prev, ...newObjects]);
    },
    [
      spawnControls.x,
      spawnControls.z,
      spawnControls.radius,
      spawnControls.height,
    ]
  );

  const elevationUniforms = useMemo(
    () => ({
      uHeightmapScale: uniform(30.0).setName("uHeightmapScale"),
      uNoiseScale: uniform(0.015).setName("uNoiseScale"),
    }),
    []
  );

  const colorNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => vec3(0.3, 0.5, 0.2))();
    }
    return Fn(() => helloTerrainMesh.varyings.vNormal.toColor())();
  }, [helloTerrainMesh]);

  // Update terrain and metrics
  useFrame(() => {
    elevationUniforms.uHeightmapScale.value = terrainControls.heightmapScale;
    elevationUniforms.uNoiseScale.value = terrainControls.noiseScale;

    if (helloTerrainMesh) {
      helloTerrainMesh.uniforms.uSegments.value = terrainControls.segments;
      helloTerrainMesh.uniforms.setHeightmapScale(
        terrainControls.heightmapScale
      );

      const qConfig = helloTerrainMesh.quadtree.getConfig();
      qConfig.rootSize = terrainControls.rootSize;
      qConfig.maxLevel = terrainControls.maxLevel;

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

      const hasValid = (
        helloTerrainMesh as unknown as { hasValidHeightData: boolean }
      ).hasValidHeightData;
      setMetric("terrainReady", hasValid ? "yes" : "loading...");
      setMetric(
        "nodeCount",
        `${helloTerrainMesh.metrics.leafNodeCount} / ${helloTerrainMesh.metrics.nodeCount}`
      );
    }

    setMetric("objectCount", physicsObjects.length.toString());
    setMetric("colliderReady", colliderReady ? "yes" : "building...");

    if (debugHeights) {
      const minH = Math.min(...debugHeights);
      const maxH = Math.max(...debugHeights);
      setMetric("heightRange", `${minH.toFixed(1)} - ${maxH.toFixed(1)}`);
    }

    setMetric(
      "spawnPoint",
      `${spawnControls.x.toFixed(0)}, ${spawnControls.height.toFixed(0)}, ${spawnControls.z.toFixed(0)}`
    );
  });

  const elevationFn = useMemo(
    () =>
      ElevationFn(({ worldPosition }) => {
        const noise = voronoiCells({
          scale: float(1),
          facet: 0,
          seed: 0,
          uv: vec2(worldPosition.x, worldPosition.z).mul(
            elevationUniforms.uNoiseScale
          ),
        }).mul(elevationUniforms.uHeightmapScale);
        return noise;
      }),
    [elevationUniforms]
  );

  const positionNode = useMemo(() => {
    if (!helloTerrainMesh) return Fn(() => vec3(0, 0, 0))();
    return helloTerrainMesh.positionNode();
  }, [helloTerrainMesh]);

  const normalNode = useMemo(() => {
    if (!helloTerrainMesh) return Fn(() => vec3(0, 1, 0))();
    return transformNormalToView(helloTerrainMesh.varyings.vNormal);
  }, [helloTerrainMesh]);

  return (
    <>
      {/* Terrain visual mesh */}
      <hello.TerrainMesh
        receiveShadow
        castShadow
        frustumCulled={false}
        ref={(ref) => {
          if (!helloTerrainMesh && ref) {
            setHelloTerrainMesh(ref);
          }
        }}
        elevationFn={elevationFn}
        maxNodes={1000}
        rootSize={terrainControls.rootSize}
        innerTileSegments={terrainControls.segments}
        subdivisionFactor={2}
        minNodeSize={terrainControls.segments}
        maxLevel={terrainControls.maxLevel}
      >
        <meshStandardNodeMaterial
          name="TerrainMeshMaterial"
          wireframe={terrainControls.wireframe}
          positionNode={positionNode}
          colorNode={colorNode}
          normalNode={normalNode}
        />
      </hello.TerrainMesh>

      {/* Terrain physics collider - uses terrain.getHeightfieldGrid() */}
      <TerrainCollider
        terrainMesh={helloTerrainMesh}
        size={terrainControls.rootSize}
        onReady={setColliderReady}
        onHeightsUpdate={setDebugHeights}
        showDebug={debugControls.showCollider}
      />

      {/* Spawn point marker - drag to move spawn location */}
      <SpawnPointMarker
        position={[spawnControls.x, spawnControls.height, spawnControls.z]}
        onPositionChange={(x, z) => {
          setSpawnControls({ x, z });
        }}
      />

      {/* Physics objects - Rapier handles collision with heightfield */}
      {physicsObjects.map((obj) =>
        obj.type === "sphere" ? (
          <PhysicsSphere
            key={obj.id}
            position={obj.position}
            color={obj.color}
          />
        ) : (
          <PhysicsCube key={obj.id} position={obj.position} color={obj.color} />
        )
      )}
    </>
  );
};

// Instructions overlay
const Instructions = () => (
  <div
    style={{
      position: "absolute",
      bottom: 20,
      left: 20,
      padding: "16px 20px",
      background: "rgba(0, 0, 0, 0.8)",
      borderRadius: "12px",
      color: "white",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "13px",
      backdropFilter: "blur(10px)",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      maxWidth: "320px",
    }}
  >
    <div
      style={{
        fontWeight: 600,
        marginBottom: "12px",
        fontSize: "14px",
        color: "#00ff88",
      }}
    >
      Heightfield Collision Test
    </div>
    <div style={{ display: "grid", gap: "8px", opacity: 0.9 }}>
      <div>
        <strong>Spawn Point:</strong> Drag the green marker or use panel
      </div>
      <div>
        <strong>Objects:</strong> Click Physics buttons to spawn spheres/cubes
      </div>
      <div>
        <strong style={{ color: "#ff00ff" }}>Debug:</strong> Magenta wireframe
        shows physics collider
      </div>
    </div>
  </div>
);

// Performance tips overlay
const PerformanceTips = () => (
  <div
    style={{
      position: "absolute",
      top: 20,
      right: 20,
      padding: "12px 16px",
      background: "rgba(0, 50, 100, 0.85)",
      borderRadius: "8px",
      color: "#a0d8ff",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "11px",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(100, 180, 255, 0.2)",
      maxWidth: "300px",
    }}
  >
    <div style={{ fontWeight: 600, marginBottom: "8px", color: "#60c0ff" }}>
      💡 Terrain Heightfield API
    </div>
    <code
      style={{
        display: "block",
        background: "rgba(0,0,0,0.3)",
        padding: "8px",
        borderRadius: "4px",
        fontSize: "10px",
        lineHeight: 1.4,
      }}
    >
      {`// Get heights directly from terrain
const heights = terrain
  .getHeightfieldGrid(64, 200);

// Create Rapier heightfield collider
<HeightfieldCollider
  args={[63, 63, heights,
    { x: 200, y: 1, z: 200 }]}
/>`}
    </code>
  </div>
);

const HeightmapCollisionTest = () => {
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
          position: [80, 100, 80],
          fov: 60,
        }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <color attach="background" args={["#0a1628"]} />
        <Environment
          preset="night"
          background={false}
          environmentIntensity={0.4}
        />
        <ambientLight intensity={0.4} />
        <directionalLight
          intensity={1.2}
          position={[50, 80, 30]}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={300}
          shadow-camera-left={-100}
          shadow-camera-right={100}
          shadow-camera-top={100}
          shadow-camera-bottom={-100}
        />
        <fog attach="fog" args={["#0a1628", 150, 400]} />

        <Physics gravity={[0, -20, 0]} timeStep="vary">
          <TerrainWithPhysics />
        </Physics>
        <OrbitControls />
      </Canvas>
      <Instructions />
      <PerformanceTips />
    </>
  );
};

export default HeightmapCollisionTest;
