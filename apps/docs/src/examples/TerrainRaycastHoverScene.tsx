"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  elevationFn,
  elevationScale,
  innerTileSegments,
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
  type LeafSet,
  type TerrainGraph,
  type TerrainQuery,
  type TerrainTile,
  type UpdateParams,
} from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { Canvas, extend, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  cos,
  dot,
  float,
  Fn,
  floor,
  fract,
  Loop,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

type HoverInfo = {
  point: THREE.Vector3;
  elevation: number;
  tile: TerrainTile | null;
};

type HoverOverlayInfo = HoverInfo & {
  screenX: number;
  screenY: number;
};

const CAMERA_HYSTERESIS = 0.05;

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

type LevaStore = ReturnType<typeof useCreateStore>;

function TerrainRaycastHoverSceneImpl({
  g,
  store,
  onHoverChange,
}: {
  g: TerrainGraph;
  store: LevaStore;
  onHoverChange: (next: HoverOverlayInfo | null) => void;
}) {
  const meshRef = useRef<TerrainMesh | null>(null);
  const materialRef = useRef<THREE.MeshBasicNodeMaterial | null>(null);
  const lastPositionNodeRef = useRef<THREE.TSL.ShaderCallNodeInternal | null>(
    null,
  );
  const lastCameraRef = useRef(new THREE.Vector3());
  const hoverRef = useRef<HoverInfo | null>(null);
  const terrainQueryRef = useRef<TerrainQuery | null>(null);

  const controls = useControls(
    "Terrain",
    {
      elevationScale: {
        value: 15,
        min: 1,
        max: 100,
        step: 1,
        label: "elevation scale",
      },
      maxLevel: { value: 12, min: 2, max: 24, step: 2, label: "max level" },
      innerTileSegments: {
        value: 64,
        min: 3,
        max: 64,
        step: 1,
        label: "tile segments",
      },
      highlightRadius: {
        value: 14,
        min: 1,
        max: 80,
        step: 1,
        label: "highlight radius",
      },
    },
    { store },
  );

  const uHoverCenter = useMemo(
    () => uniform(new THREE.Vector3(0, -1e6, 0)).setName("uHoverCenter"),
    [],
  );
  const uHoverRadius = useMemo(() => uniform(0).setName("uHoverRadius"), []);

  useEffect(() => {
    g.set(rootSize, 1024);
    g.set(maxNodes, 1024);
    g.set(skirtScale, 100);
  }, [g]);

  useEffect(() => {
    g.set(elevationScale, () => controls.elevationScale);
    g.set(maxLevel, () => controls.maxLevel);
    g.set(innerTileSegments, () => controls.innerTileSegments);
  }, [
    g,
    controls.elevationScale,
    controls.maxLevel,
    controls.innerTileSegments,
  ]);

  useEffect(() => {
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const p = vec2(worldPosition.x, worldPosition.z).mul(float(0.05));
      return fbm(p).sub(float(0.3));
    };
    g.set(elevationFn, () => elevation);
  }, [g]);

  const colorNode = useMemo(
    () =>
      Fn(() => {
        const baseColor = vec3(0.38, 0.53, 0.36);
        const paintColor = vec3(0.15, 0.72, 0.95);
        const lightDir = normalize(vec3(0.5, 0.8, 0.3));
        const ambient = float(0.32);
        const diff = max(dot(normalWorld, lightDir), float(0));
        const litBase = baseColor.mul(ambient.add(diff.mul(float(0.68))));
        const dist = positionWorld.sub(uHoverCenter).length();
        const mask = float(1).sub(
          smoothstep(uHoverRadius.mul(float(0.35)), uHoverRadius, dist),
        );
        const mixed = mix(litBase, paintColor, mask.mul(float(0.75)));
        return vec4(mixed, float(1));
      })(),
    [uHoverCenter, uHoverRadius],
  );

  useFrame(async ({ camera, gl }) => {
    if (
      lastCameraRef.current.distanceToSquared(camera.position) >=
      CAMERA_HYSTERESIS * CAMERA_HYSTERESIS
    ) {
      g.set(quadtreeUpdate, (prev: UpdateParams) => {
        prev.cameraOrigin.x = camera.position.x;
        prev.cameraOrigin.y = camera.position.y;
        prev.cameraOrigin.z = camera.position.z;
        return prev;
      });
      lastCameraRef.current.copy(camera.position);
    }

    await g.run({
      resources: { renderer: gl as unknown as THREE.WebGPURenderer },
    });

    const mesh = meshRef.current;
    if (!mesh) return;
    const leaves = g.peek(terrainTasks.quadtreeUpdate) as LeafSet | undefined;
    if (leaves && mesh.count !== leaves.count) {
      mesh.count = leaves.count;
      mesh.instanceMatrix.needsUpdate = true;
    }

    const positionNode = g.peek(positionNodeTask);
    const material = materialRef.current;
    if (
      material &&
      positionNode &&
      positionNode !== lastPositionNodeRef.current
    ) {
      material.positionNode = positionNode;
      material.needsUpdate = true;
      lastPositionNodeRef.current = positionNode;
    }

    const terrainRaycast = g.peek(terrainTasks.terrainRaycast);
    if (terrainRaycast) {
      mesh.terrainRaycast = terrainRaycast;
    }

    terrainQueryRef.current = g.peek(terrainTasks.terrainQuery)?.query ?? null;

    if (hoverRef.current) {
      uHoverCenter.value.copy(hoverRef.current.point);
      uHoverRadius.value = controls.highlightRadius;
    } else {
      uHoverCenter.value.set(0, -1e6, 0);
      uHoverRadius.value = 0;
    }
  });

  return (
    <>
      <terrainMesh
        ref={meshRef}
        innerTileSegments={controls.innerTileSegments}
        maxNodes={1024}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          const point = event.point.clone();
          const tq = terrainQueryRef.current;
          const tile = tq ? tq.getTile(point.x, point.z) : null;
          const nextHover = {
            point,
            elevation: point.y,
            tile,
            screenX: event.nativeEvent.clientX,
            screenY: event.nativeEvent.clientY,
          };
          hoverRef.current = nextHover;
          onHoverChange(nextHover);
        }}
        onPointerOut={() => {
          hoverRef.current = null;
          onHoverChange(null);
        }}
      >
        <meshBasicNodeMaterial ref={materialRef} colorNode={colorNode} />
      </terrainMesh>
    </>
  );
}

export default function TerrainRaycastHoverScene() {
  const store = useCreateStore();
  const g = useMemo(() => terrainGraph(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const elevationTextRef = useRef<HTMLDivElement | null>(null);
  const tileTextRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef<HoverOverlayInfo | null>(null);

  const onHoverChange = useCallback((next: HoverOverlayInfo | null) => {
    hoverRef.current = next;
  }, []);

  useEffect(() => {
    let frameHandle = 0;
    const tick = () => {
      const tooltip = tooltipRef.current;
      const container = containerRef.current;
      if (!tooltip || !container) {
        frameHandle = requestAnimationFrame(tick);
        return;
      }
      const hover = hoverRef.current;
      if (!hover) {
        tooltip.style.display = "none";
        frameHandle = requestAnimationFrame(tick);
        return;
      }
      const rect = container.getBoundingClientRect();
      const localX = hover.screenX - rect.left;
      const localY = hover.screenY - rect.top;
      tooltip.style.display = "block";
      tooltip.style.left = `${localX}px`;
      tooltip.style.top = `${localY - 12}px`;
      if (elevationTextRef.current) {
        elevationTextRef.current.textContent = `elevation: ${hover.elevation.toFixed(2)}`;
      }
      if (tileTextRef.current) {
        tileTextRef.current.textContent = hover.tile
          ? `tile: L${hover.tile.level} (${hover.tile.x}, ${hover.tile.y}) #${hover.tile.index}`
          : "tile: n/a";
      }
      frameHandle = requestAnimationFrame(tick);
    };
    frameHandle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameHandle);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <ExamplesCanvas store={store}>
        <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
          <RunTimingBars graph={g} />
          <div className="flex flex-row gap-1.5">
            <TerrainTileDebug graph={g} />
            <FpsDebug />
          </div>
        </div>
        <Canvas
          className="touch-none relative w-full h-full top-0 left-0"
          gl={async (props) => {
            props.alpha = true;
            props.antialias = true;
            const renderer = new THREE.WebGPURenderer(
              props as WebGPURendererParameters,
            );
            await renderer.init();
            return renderer;
          }}
          camera={{ position: [0, 38, 70] }}
          dpr={[1, 1]}
          performance={{ min: 0.5 }}
        >
          <ambientLight intensity={0.25} />
          <directionalLight intensity={1.1} position={[1, 1, 1]} />
          <TerrainRaycastHoverSceneImpl
            g={g}
            store={store}
            onHoverChange={onHoverChange}
          />
          <OrbitControls makeDefault target={[0, 4, 0]} />
        </Canvas>
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-20 rounded-md border border-white/15 bg-black/75 px-3 py-2 text-xs text-white shadow-md"
          style={{
            display: "none",
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="font-medium">Terrain Hit</div>
          <div ref={elevationTextRef}>elevation: 0.00</div>
          <div ref={tileTextRef}>tile: n/a</div>
        </div>
      </ExamplesCanvas>
    </div>
  );
}
