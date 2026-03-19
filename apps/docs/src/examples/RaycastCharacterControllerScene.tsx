"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  CharacterController,
  type CharacterControllerSnapshot,
} from "@/examples/character/CharacterController";
import {
  elevationFn,
  elevationScale,
  innerTileSegments,
  type LeafSet,
  maxLevel,
  maxNodes,
  positionNodeTask,
  quadtreeUpdate,
  rootSize,
  skirtScale,
  TerrainGeometry,
  terrainGraph,
  terrainTasks,
  TerrainMesh,
  type ElevationCallback,
  type TerrainGraph,
  type TerrainQuery,
  type TerrainRaycast,
  type UpdateParams,
} from "@hello-terrain/three";
import { Environment } from "@react-three/drei";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  cos,
  dot,
  float,
  Fn,
  floor,
  fract,
  Loop,
  mix,
  sin,
  vec2,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

type LevaStore = ReturnType<typeof useCreateStore>;

const randomGradient = Fn(([p]: [any]) => {
  const angle = fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)).mul(
    Math.PI * 2,
  );
  return vec2(cos(angle), sin(angle));
});

const perlinNoise = Fn(([p]: [any]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));

  const g00 = randomGradient(i);
  const g10 = randomGradient(i.add(vec2(1, 0)));
  const g01 = randomGradient(i.add(vec2(0, 1)));
  const g11 = randomGradient(i.add(vec2(1, 1)));

  const d00 = dot(g00, f);
  const d10 = dot(g10, f.sub(vec2(1, 0)));
  const d01 = dot(g01, f.sub(vec2(0, 1)));
  const d11 = dot(g11, f.sub(vec2(1, 1)));

  return mix(mix(d00, d10, u.x), mix(d01, d11, u.x), u.y).add(0.5);
});

const fbm = Fn(([pos_immutable]: [any]) => {
  const p = vec2(pos_immutable).toVar();
  const total = float(0).toVar();
  const amp = float(0.5).toVar();
  const freq = float(1).toVar();

  Loop(6, () => {
    total.addAssign(perlinNoise(p.mul(freq)).mul(amp));
    freq.mulAssign(2.03);
    amp.mulAssign(0.5);
  });

  return total;
});

const QUADTREE_ORIGIN_HYSTERESIS = 0.35;
const QUADTREE_ORIGIN_SNAP = 0.25;

function snapToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function CharacterHud({
  snapshot,
}: {
  snapshot: CharacterControllerSnapshot | null;
}) {
  return (
    <>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80">
        <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </div>
      <div className="pointer-events-none absolute left-2 top-14 z-10 rounded-md border border-white/10 bg-black/55 px-3 py-2 text-xs text-white backdrop-blur-sm md:left-4 md:top-16">
        <div className="font-medium">Character Controller</div>
        <div>state: {snapshot?.state ?? "booting"}</div>
        <div>grounded: {snapshot?.isGrounded ? "yes" : "no"}</div>
        <div>
          pointer lock: {snapshot?.isPointerLocked ? "locked" : "click canvas"}
        </div>
        <div>
          speed:{" "}
          {snapshot
            ? Math.hypot(snapshot.velocity.x, snapshot.velocity.z).toFixed(2)
            : "0.00"}
        </div>
        <div>
          position:{" "}
          {snapshot
            ? `${snapshot.position.x.toFixed(1)}, ${snapshot.position.y.toFixed(1)}, ${snapshot.position.z.toFixed(1)}`
            : "0.0, 0.0, 0.0"}
        </div>
        <div className="mt-1 text-white/70">
          WASD move, Shift sprint, Space jump
        </div>
        <div className="text-white/70">Fullscreen + wheel zooms camera</div>
      </div>
    </>
  );
}

function RaycastCharacterControllerSceneImpl({
  g,
  store,
  onCharacterUpdate,
}: {
  g: TerrainGraph;
  store: LevaStore;
  onCharacterUpdate: (snapshot: CharacterControllerSnapshot) => void;
}) {
  const meshRef = useRef<TerrainMesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardNodeMaterial | null>(null);
  const lastPositionNodeRef = useRef<THREE.TSL.ShaderCallNodeInternal | null>(
    null,
  );
  const terrainQueryRef = useRef<TerrainQuery | null>(null);
  const terrainRaycastRef = useRef<TerrainRaycast | null>(null);
  const characterSnapshotRef = useRef<CharacterControllerSnapshot | null>(null);
  const lastQuadtreeOriginRef = useRef<THREE.Vector3 | null>(null);
  const nextQuadtreeOriginRef = useRef(new THREE.Vector3());

  const controls = useControls(
    "Raycast Character Controller",
    {
      rootSize: {
        value: 4096,
        min: 128,
        max: 4096,
        step: 32,
        label: "root size",
      },
      maxLevel: {
        value: 6,
        min: 2,
        max: 20,
        step: 1,
        label: "max level",
      },
      maxNodes: {
        value: 1024,
        min: 128,
        max: 4096,
        step: 1,
        label: "max nodes",
      },
      skirtScale: {
        value: 100,
        min: 0,
        max: 1000,
        step: 1,
        label: "skirt scale",
      },
      elevationScale: {
        value: 200,
        min: 1,
        max: 128,
        step: 1,
        label: "elevation scale",
      },
      innerTileSegments: {
        value: 64,
        min: 3,
        max: 64,
        step: 1,
        label: "tile segments",
      },
      noiseScale: {
        value: 0.001,
        min: 0.001,
        max: 0.5,
        step: 0.001,
        label: "noise scale",
      },
      cameraRadius: {
        value: 4.8,
        min: 2,
        max: 12,
        step: 0.1,
        label: "camera radius",
      },
      cameraMinRadius: {
        value: 1.75,
        min: 0.75,
        max: 4,
        step: 0.05,
        label: "camera min radius",
      },
      sensitivityX: {
        value: 0.16,
        min: 0.01,
        max: 0.5,
        step: 0.01,
        label: "mouse sensitivity x",
      },
      sensitivityY: {
        value: 0.12,
        min: 0.01,
        max: 0.5,
        step: 0.01,
        label: "mouse sensitivity y",
      },
      wireframe: {
        value: false,
      },
    },
    { store },
  );

  useEffect(() => {
    g.set(rootSize, () => controls.rootSize);
  }, [controls.rootSize, g]);

  useEffect(() => {
    g.set(maxLevel, () => controls.maxLevel);
  }, [controls.maxLevel, g]);

  useEffect(() => {
    g.set(maxNodes, () => controls.maxNodes);
  }, [controls.maxNodes, g]);

  useEffect(() => {
    g.set(skirtScale, () => controls.skirtScale);
  }, [controls.skirtScale, g]);

  useEffect(() => {
    g.set(elevationScale, () => controls.elevationScale);
  }, [controls.elevationScale, g]);

  useEffect(() => {
    g.set(innerTileSegments, () => controls.innerTileSegments);
  }, [controls.innerTileSegments, g]);

  useEffect(() => {
    const noiseScaleValue = controls.noiseScale;
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const p = vec2(worldPosition.x, worldPosition.z).mul(
        float(noiseScaleValue),
      );
      return fbm(p).sub(float(0.3));
    };
    g.set(elevationFn, () => elevation);
  }, [controls.noiseScale, g]);

  useFrame(async ({ gl }) => {
    const playerPosition = characterSnapshotRef.current?.position;
    const nextOriginX = snapToStep(
      playerPosition?.x ?? 0,
      QUADTREE_ORIGIN_SNAP,
    );
    const nextOriginY = snapToStep(
      playerPosition?.y ?? 12,
      QUADTREE_ORIGIN_SNAP,
    );
    const nextOriginZ = snapToStep(
      playerPosition?.z ?? 0,
      QUADTREE_ORIGIN_SNAP,
    );
    nextQuadtreeOriginRef.current.set(nextOriginX, nextOriginY, nextOriginZ);

    const lastOrigin = lastQuadtreeOriginRef.current;
    const shouldUpdateOrigin =
      !lastOrigin ||
      lastOrigin.distanceToSquared(nextQuadtreeOriginRef.current) >=
        QUADTREE_ORIGIN_HYSTERESIS * QUADTREE_ORIGIN_HYSTERESIS;

    if (shouldUpdateOrigin) {
      g.set(quadtreeUpdate, (prev: UpdateParams) => {
        prev.cameraOrigin.x = nextOriginX;
        prev.cameraOrigin.y = nextOriginY;
        prev.cameraOrigin.z = nextOriginZ;
        return prev;
      });

      if (!lastOrigin) {
        lastQuadtreeOriginRef.current = new THREE.Vector3(
          nextOriginX,
          nextOriginY,
          nextOriginZ,
        );
      } else {
        lastOrigin.set(nextOriginX, nextOriginY, nextOriginZ);
      }
    }

    await g.run({
      resources: { renderer: gl as unknown as THREE.WebGPURenderer },
    });

    const mesh = meshRef.current;
    const material = materialRef.current;
    const leaves = g.peek(terrainTasks.quadtreeUpdate) as LeafSet | undefined;
    const positionNode = g.peek(positionNodeTask);

    if (mesh && leaves && mesh.count !== leaves.count) {
      mesh.count = leaves.count;
      mesh.instanceMatrix.needsUpdate = true;
    }

    if (
      material &&
      positionNode &&
      positionNode !== lastPositionNodeRef.current
    ) {
      material.positionNode = positionNode;
      material.needsUpdate = true;
      lastPositionNodeRef.current = positionNode;
    }

    terrainQueryRef.current = g.peek(terrainTasks.terrainQuery)?.query ?? null;

    const terrainRaycast = g.peek(terrainTasks.terrainRaycast) ?? null;
    terrainRaycastRef.current = terrainRaycast;
    if (mesh && terrainRaycast) {
      mesh.terrainRaycast = terrainRaycast;
    }
  });

  return (
    <>
      <CharacterController
        terrainQueryRef={terrainQueryRef}
        terrainRaycastRef={terrainRaycastRef}
        initialPosition={[0, 12, 0]}
        cameraRadius={controls.cameraRadius}
        cameraMinRadius={Math.min(
          controls.cameraMinRadius,
          controls.cameraRadius - 0.1,
        )}
        cameraSensitivityX={controls.sensitivityX}
        cameraSensitivityY={controls.sensitivityY}
        onUpdate={(snapshot) => {
          characterSnapshotRef.current = snapshot;
          onCharacterUpdate(snapshot);
        }}
      />

      <terrainMesh
        ref={meshRef}
        castShadow
        receiveShadow
        innerTileSegments={controls.innerTileSegments}
        maxNodes={controls.maxNodes}
      >
        <meshStandardNodeMaterial
          ref={materialRef}
          wireframe={controls.wireframe}
          color="#5f7655"
          metalness={0.03}
          roughness={0.94}
        />
      </terrainMesh>
    </>
  );
}

export default function RaycastCharacterControllerScene() {
  const store = useCreateStore();
  const g = useMemo(() => terrainGraph(), []);
  const [snapshot, setSnapshot] = useState<CharacterControllerSnapshot | null>(
    null,
  );

  return (
    <ExamplesCanvas store={store}>
      <CharacterHud snapshot={snapshot} />
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 flex flex-col gap-1.5 md:bottom-4 md:left-auto md:right-4 md:max-w-xs">
        <RunTimingBars graph={g} />
        <div className="flex flex-row gap-1.5">
          <TerrainTileDebug graph={g} />
          <FpsDebug />
        </div>
      </div>
      <Canvas
        className="touch-none relative left-0 top-0 h-full w-full"
        shadows
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(
            props as WebGPURendererParameters,
          );
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          await renderer.init();
          return renderer;
        }}
        camera={{ position: [0, 10, 10], fov: 60, near: 0.01, far: 4000 }}
        // dpr={[1.5, 1.5]}
        performance={{ min: 0.5 }}
      >
        <color attach="background" args={["#34A8CD"]} />
        <fog attach="fog" args={["#34A8CD", 90, 4000]} />
        <ambientLight intensity={0.45} />
        <hemisphereLight intensity={0.45} groundColor="#334433" />
        {/* <directionalLight
          castShadow
          intensity={2.5}
          position={[40, 110, 24]}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        /> */}
        <Environment preset="park" />
        <RaycastCharacterControllerSceneImpl
          g={g}
          store={store}
          onCharacterUpdate={setSnapshot}
        />
      </Canvas>
    </ExamplesCanvas>
  );
}
