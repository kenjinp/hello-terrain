"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { RunTimingBars } from "@/components/RunTimingBars";
import { TerrainTileDebug } from "@/components/TerrainTileDebug";
import {
  blendAngleCorrectedNormals,
  createControlMapContextTask,
  decodeControlBaseId,
  decodeControlBlend,
  decodeControlOverlayId,
  decodeControlUvScale,
  deriveNormalZ,
  elevationFn,
  elevationScale,
  innerTileSegments,
  maxLevel,
  maxNodes,
  positionNodeTask,
  quadtreeUpdate,
  quadtreeUpdateTask,
  readControlMapPacked,
  rootSize,
  skirtScale,
  textureControlFn,
  textureSpaceToVectorSpace,
  terrainGraph,
  TerrainGeometry,
  TerrainMesh,
  vectorSpaceToTextureSpace,
  vGlobalVertexIndex,
  type ElevationCallback,
  type TextureControlCallback,
  type UpdateParams,
} from "@hello-terrain/three";
import { Graph, task, type TaskRef } from "@hello-terrain/work";
import { OrbitControls } from "@react-three/drei";
import {
  Canvas,
  extend,
  useFrame,
  useLoader,
  useThree,
} from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { Suspense, useEffect, useMemo, useRef } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  cos,
  dot,
  fwidth,
  float,
  Fn,
  floor,
  fract,
  int,
  Loop,
  mix,
  normalMap,
  positionWorld,
  select,
  sin,
  texture,
  vec2,
} from "three/tsl";
import * as THREE from "three/webgpu";

extend(THREE as any);
extend({ TerrainGeometry, TerrainMesh });

const MATERIAL_SETS = [
  {
    id: "moss",
    role: "overlay on forest floor",
    albedo: "/assets/materials/moss/moss_albedo.ktx2",
    normal: "/assets/materials/moss/moss_normal.ktx2",
    aorh: "/assets/materials/moss/moss_aorh.ktx2",
  },
  {
    id: "cliff",
    role: "stone on slopes",
    albedo: "/assets/materials/cliff/cliff_albedo.ktx2",
    normal: "/assets/materials/cliff/cliff_normal.ktx2",
    aorh: "/assets/materials/cliff/cliff_aorh.ktx2",
  },
  {
    id: "ground-forest-stone",
    role: "forest floor base",
    albedo:
      "/assets/materials/ground-forest-stone/ground_forest_stone_albedo.ktx2",
    normal:
      "/assets/materials/ground-forest-stone/ground_forest_stone_normal.ktx2",
    aorh: "/assets/materials/ground-forest-stone/ground_forest_stone_aorh.ktx2",
  },
] as const;

type LoadedSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  aorh: THREE.Texture;
};

function selectById(id: any, values: any[]) {
  let selected = values[0];
  for (let i = 1; i < values.length; i += 1) {
    selected = select(id.equal(int(i)), values[i], selected);
  }
  return selected;
}

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

  Loop(5, () => {
    total.addAssign(perlinNoise(p.mul(freq)).mul(amp));
    freq.mulAssign(2.03);
    amp.mulAssign(0.5);
  });

  return total;
});

type TerrainTexturingSceneImplProps = {
  g: Graph;
  rendererTask: TaskRef<THREE.WebGPURenderer | null>;
  controls: {
    rootSize: number;
    maxLevel: number;
    maxNodes: number;
    skirtScale: number;
    elevationScale: number;
    innerTileSegments: number;
    noiseScale: number;
    cliffSlopeThreshold: number;
    mossBlendStrength: number;
    mossNoiseScale: number;
    mossNoiseThreshold: number;
    mossEdgeSharpness: number;
    screenSpaceDenoise: number;
    screenSpaceDenoiseRadius: number;
    uvScale: number;
    wireframe: boolean;
  };
};

const TerrainTexturingSceneImpl = ({
  g,
  rendererTask,
  controls,
}: TerrainTexturingSceneImplProps) => {
  const { gl } = useThree();
  const maxAnisotropy =
    (gl as unknown as { capabilities?: { getMaxAnisotropy?: () => number } })
      .capabilities?.getMaxAnisotropy?.() ?? 1;

  const lastCameraRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardNodeMaterial | null>(null);

  const textureUrls = useMemo(
    () => MATERIAL_SETS.flatMap((set) => [set.albedo, set.normal, set.aorh]),
    [],
  );
  const loadedTextures = useLoader(KTX2Loader, textureUrls, async (loader) => {
    loader.setTranscoderPath(
      "https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/basis/",
    );
    loader.detectSupport(gl);
  });

  const textureSets = useMemo<LoadedSet[]>(() => {
    const out: LoadedSet[] = [];
    for (let i = 0; i < MATERIAL_SETS.length; i += 1) {
      const base = i * 3;
      const albedo = loadedTextures[base]!;
      const normal = loadedTextures[base + 1]!;
      const aorh = loadedTextures[base + 2]!;
      albedo.colorSpace = THREE.SRGBColorSpace;
      normal.colorSpace = THREE.LinearSRGBColorSpace;
      aorh.colorSpace = THREE.LinearSRGBColorSpace;
      albedo.wrapS = THREE.RepeatWrapping;
      albedo.wrapT = THREE.RepeatWrapping;
      normal.wrapS = THREE.RepeatWrapping;
      normal.wrapT = THREE.RepeatWrapping;
      aorh.wrapS = THREE.RepeatWrapping;
      aorh.wrapT = THREE.RepeatWrapping;
      albedo.generateMipmaps = true;
      normal.generateMipmaps = true;
      aorh.generateMipmaps = true;
      albedo.minFilter = THREE.LinearMipmapLinearFilter;
      normal.minFilter = THREE.LinearMipmapLinearFilter;
      aorh.minFilter = THREE.LinearMipmapLinearFilter;
      albedo.magFilter = THREE.LinearFilter;
      normal.magFilter = THREE.LinearFilter;
      aorh.magFilter = THREE.LinearFilter;
      albedo.anisotropy = maxAnisotropy;
      normal.anisotropy = maxAnisotropy;
      aorh.anisotropy = maxAnisotropy;
      albedo.needsUpdate = true;
      normal.needsUpdate = true;
      aorh.needsUpdate = true;
      out.push({ albedo, normal, aorh });
    }
    return out;
  }, [loadedTextures, maxAnisotropy]);

  useEffect(() => {
    g.add(
      task((get, work) => {
        const leafSet = get(quadtreeUpdateTask);
        return work(() => {
          const mesh = meshRef.current;
          if (
            mesh &&
            leafSet?.count !== undefined &&
            leafSet.count !== mesh.count
          ) {
            mesh.count = leafSet.count;
            mesh.instanceMatrix.needsUpdate = true;
          }
        });
      }).displayName("applyTexturedCount"),
    );

    g.add(
      task((get, work) => {
        const positionNode = get(positionNodeTask);
        const controlMapContext = get(createControlMapContextTask);
        return work(() => {
          const material = materialRef.current;
          if (!material || !positionNode || textureSets.length === 0) return;

          const textureScale = float(3.5);
          const screenSpaceDenoise = float(controls.screenSpaceDenoise);
          const screenSpaceDenoiseRadius = float(controls.screenSpaceDenoiseRadius);

          const sampleScreenSpaceFiltered = (map: THREE.Texture, uv: any) => {
            const center = texture(map, uv);
            const duv = fwidth(uv).mul(screenSpaceDenoiseRadius);
            const sx = vec2(duv.x, 0);
            const sy = vec2(0, duv.y);
            const blurred = center
              .add(texture(map, uv.add(sx)))
              .add(texture(map, uv.sub(sx)))
              .add(texture(map, uv.add(sy)))
              .add(texture(map, uv.sub(sy)))
              .mul(float(0.2));
            return center.mix(blurred, screenSpaceDenoise);
          };

          material.colorNode = Fn(() => {
            const packed = readControlMapPacked(
              controlMapContext.node,
              vGlobalVertexIndex,
            );
            const baseId = decodeControlBaseId(packed);
            const overlayId = decodeControlOverlayId(packed);
            const blend = decodeControlBlend(packed);
            const uvScale = decodeControlUvScale(packed);
            const uv = vec2(positionWorld.x, positionWorld.z)
              .div(textureScale)
              .div(uvScale.max(float(1)));
            const albedoSamples = textureSets.map((set) =>
              sampleScreenSpaceFiltered(set.albedo, uv),
            );
            const aorhSamples = textureSets.map((set) =>
              sampleScreenSpaceFiltered(set.aorh, uv),
            );
            const baseColor = selectById(baseId, albedoSamples).rgb;
            const overlayColor = selectById(overlayId, albedoSamples).rgb;
            const baseHeight = selectById(baseId, aorhSamples).b;
            const overlayHeight = selectById(overlayId, aorhSamples).b;
            // Gate height-based blend by explicit influence so tiny moss values stay subtle.
            const heightW = blend
              .add(overlayHeight.sub(baseHeight).mul(float(6)).mul(blend))
              .max(0)
              .min(1);
            return baseColor.mix(overlayColor, heightW);
          })();

          material.normalNode = Fn(() => {
            const packed = readControlMapPacked(
              controlMapContext.node,
              vGlobalVertexIndex,
            );
            const baseId = decodeControlBaseId(packed);
            const overlayId = decodeControlOverlayId(packed);
            const blend = decodeControlBlend(packed);
            const uvScale = decodeControlUvScale(packed);
            const uv = vec2(positionWorld.x, positionWorld.z)
              .div(textureScale)
              .div(uvScale.max(float(1)));
            const normalSamples = textureSets.map((set) =>
              sampleScreenSpaceFiltered(set.normal, uv),
            );
            const baseRG = selectById(baseId, normalSamples).rg;
            const overlayRG = selectById(overlayId, normalSamples).rg;
            const n1 = deriveNormalZ(textureSpaceToVectorSpace(baseRG));
            const n2 = deriveNormalZ(textureSpaceToVectorSpace(overlayRG));
            const blended = blendAngleCorrectedNormals(n1, n2).normalize();
            const mapped = n1.mix(blended, blend).normalize();
            return normalMap(vectorSpaceToTextureSpace(mapped), vec2(1, 1));
          })();

          material.roughnessNode = Fn(() => {
            const packed = readControlMapPacked(
              controlMapContext.node,
              vGlobalVertexIndex,
            );
            const baseId = decodeControlBaseId(packed);
            const overlayId = decodeControlOverlayId(packed);
            const blend = decodeControlBlend(packed);
            const uvScale = decodeControlUvScale(packed);
            const uv = vec2(positionWorld.x, positionWorld.z)
              .div(textureScale)
              .div(uvScale.max(float(1)));
            const aorhSamples = textureSets.map((set) =>
              sampleScreenSpaceFiltered(set.aorh, uv),
            );
            const baseR = selectById(baseId, aorhSamples).g;
            const overlayR = selectById(overlayId, aorhSamples).g;
            return baseR.mix(overlayR, blend).max(float(0.75));
          })();

          material.positionNode = positionNode;
          material.metalness = 0;
          material.needsUpdate = true;
        });
      }).displayName("applyTexturedNodes"),
    );
  }, [g, rendererTask, textureSets, controls.screenSpaceDenoise, controls.screenSpaceDenoiseRadius]);

  useEffect(() => {
    const noiseScaleValue = controls.noiseScale;
    const elevation: ElevationCallback = ({ worldPosition }) => {
      const p = vec2(worldPosition.x, worldPosition.z).mul(
        float(noiseScaleValue),
      );
      return fbm(p).sub(float(0.3));
    };
    g.set(elevationFn, () => elevation);
  }, [g, controls.noiseScale]);

  useEffect(() => {
    const controlFn: TextureControlCallback = ({ slope, worldPosition }) => {
      const mossNoise = fbm(
        vec2(worldPosition.x, worldPosition.z).mul(
          float(controls.mossNoiseScale),
        ),
      );
      const cliffThreshold = controls.cliffSlopeThreshold;
      const mossStrength = controls.mossBlendStrength;
      const mossThreshold = controls.mossNoiseThreshold;
      const mossEdgeSharpness = controls.mossEdgeSharpness;
      const uvScaleValue = controls.uvScale;
      const isCliff = slope.lessThan(float(cliffThreshold));
      const mossMask = mossNoise
        .sub(float(mossThreshold))
        .max(float(0))
        .div(float(1).sub(float(mossThreshold)).max(float(0.0001)))
        .min(float(1));
      const mossBlend = mossMask
        .pow(float(mossEdgeSharpness))
        .mul(float(mossStrength))
        .min(float(1));
      return {
        // Reduced scene set order: 0 moss, 1 cliff, 2 forest floor.
        baseTextureId: select(isCliff, int(1), int(2)),
        overlayTextureId: select(isCliff, int(1), int(0)),
        blend: select(isCliff, float(0), mossBlend),
        uvScale: int(uvScaleValue),
      };
    };
    g.set(textureControlFn, () => controlFn);
  }, [
    g,
    controls.cliffSlopeThreshold,
    controls.mossBlendStrength,
    controls.mossNoiseScale,
    controls.mossNoiseThreshold,
    controls.mossEdgeSharpness,
    controls.uvScale,
  ]);

  useEffect(() => {
    g.set(elevationScale, () => controls.elevationScale);
  }, [g, controls.elevationScale]);
  useEffect(() => {
    g.set(maxNodes, () => controls.maxNodes);
  }, [g, controls.maxNodes]);
  useEffect(() => {
    g.set(rootSize, () => controls.rootSize);
  }, [g, controls.rootSize]);
  useEffect(() => {
    g.set(maxLevel, () => controls.maxLevel);
  }, [g, controls.maxLevel]);
  useEffect(() => {
    g.set(skirtScale, () => controls.skirtScale);
  }, [g, controls.skirtScale]);
  useEffect(() => {
    g.set(innerTileSegments, () => controls.innerTileSegments);
  }, [g, controls.innerTileSegments]);

  useFrame(async ({ camera, gl: renderer }) => {
    const cameraHysteresis = 0.05;
    if (
      lastCameraRef.current.distanceToSquared(camera.position) >=
      cameraHysteresis * cameraHysteresis
    ) {
      g.set(quadtreeUpdate, (prev: UpdateParams) => ({
        ...prev,
        cameraOrigin: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
      }));
      lastCameraRef.current.copy(camera.position);
    }
    await g.run({ resources: { renderer } });
  });

  return (
    <>
      <terrainMesh
        ref={meshRef}
        innerTileSegments={controls.innerTileSegments}
        maxNodes={controls.maxNodes}
      >
        <meshStandardNodeMaterial
          ref={materialRef}
          wireframe={controls.wireframe}
        />
      </terrainMesh>
    </>
  );
};

const TerrainTexturingScene = () => {
  const store = useCreateStore();
  const controls = useControls(
    "Terrain Texturing",
    {
      rootSize: { value: 4096, min: 16, max: 4096, step: 16 },
      maxLevel: { value: 12, min: 2, max: 24, step: 1 },
      maxNodes: { value: 768, min: 128, max: 2048, step: 1 },
      skirtScale: { value: 10, min: 0, max: 1000, step: 1 },
      elevationScale: { value: 64, min: 1, max: 100, step: 1 },
      innerTileSegments: { value: 64, min: 3, max: 64, step: 1 },
      noiseScale: { value: 0.005, min: 0.001, max: 0.5, step: 0.001 },
      cliffSlopeThreshold: { value: 0.2, min: 0.05, max: 0.95, step: 0.01 },
      mossBlendStrength: { value: 0.45, min: 0, max: 1, step: 0.01 },
      mossNoiseScale: { value: 0.02, min: 0.001, max: 0.2, step: 0.001 },
      mossNoiseThreshold: { value: 0.45, min: 0, max: 1, step: 0.01 },
      mossEdgeSharpness: { value: 2.5, min: 1, max: 8, step: 0.1 },
      screenSpaceDenoise: { value: 0.35, min: 0, max: 1, step: 0.01 },
      screenSpaceDenoiseRadius: { value: 1, min: 0.25, max: 3, step: 0.05 },
      uvScale: { value: 1, min: 0, max: 7, step: 1 },
      wireframe: { value: false },
    },
    { store },
  );
  const g = useMemo(() => terrainGraph(), []);
  const rendererTask = useMemo(
    () =>
      task<{ renderer: THREE.WebGPURenderer }>((_get, work, { resources }) =>
        work(() => resources?.renderer ?? null),
      ).displayName("debugRendererTask"),
    [],
  );

  useEffect(() => {
    g.add(rendererTask);
  }, [g, rendererTask]);

  return (
    <ExamplesCanvas store={store}>
      <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
        <RunTimingBars graph={g} />
        <div className="flex flex-row gap-1.5">
          <TerrainTileDebug graph={g} rendererTask={rendererTask} />
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
        camera={{ position: [0, 30, 60] }}
        dpr={[1, 1]}
        performance={{ min: 0.5 }}
      >
        <ambientLight intensity={0.2} />
        <directionalLight intensity={1.2} position={[1, 1, 1]} />
        <Suspense fallback={null}>
          <TerrainTexturingSceneImpl
            g={g}
            rendererTask={rendererTask}
            controls={controls}
          />
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </ExamplesCanvas>
  );
};

export default TerrainTexturingScene;
