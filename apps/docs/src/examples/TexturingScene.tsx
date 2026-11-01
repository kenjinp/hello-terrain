"use client";

import { ExamplesCanvas, useExamplesCanvas } from "@/components/ExamplesCanvas";
import { Terrain, TerrainStandardMaterial, useTerrain } from "@hello-terrain/react";
import {
  controlMapSample, createCubeSphereTopology, decodeTextureControl, terrainTasks,
  textureControl, textureWeights, weightMapsToControl,
  type ElevationCallback, type TerrainTextureRenderOptions, type TextureCallback,
} from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fn, float, select, sin } from "three/tsl";
import { DoubleSide, Ray, Vector3, type Mesh } from "three/webgpu";
import { loadTexturingExampleAssets, type TexturingExampleAssets } from "./terrain/texturingAssets";

export type TexturingExampleMode = "procedural" | "painted" | "mixed" | "holes" | "react" | "bcn";
interface DemoOptions {
  mode: TexturingExampleMode;
  cube: boolean;
  capacity: number;
  alternate: boolean;
  focusRight: boolean;
  weights: boolean;
  readback: boolean;
  render: TerrainTextureRenderOptions;
}
interface DemoReport {
  backend: string;
  leaves: number;
  control: number | null;
  hole: boolean | null;
  valid: boolean;
  centerRayHit: boolean;
  solidRayHit: boolean;
  layers: number;
  mips: number;
  compressed: boolean;
  controlFieldId: number;
  materialArrayId: number;
}

function TexturedTerrain({ assets, options, onReport }: {
  assets: TexturingExampleAssets; options: DemoOptions; onReport: (report: DemoReport) => void;
}) {
  const topology = useMemo(() => options.cube ? createCubeSphereTopology({ radius: 80 }) : null, [options.cube]);
  const elevation = useMemo<ElevationCallback>(() => p =>
    sin(p.worldPosition.x.mul(0.045)).mul(13).add(sin(p.worldPosition.z.mul(0.07)).mul(7)), []);
  const controlMap = assets.controlMap, weightMap = assets.weightMap;
  const texture = useMemo<TextureCallback>(() => p => {
    const grass = p.slope.mul(3).oneMinus().clamp();
    const rock = p.slope.mul(3).clamp();
    const sand = p.elevation.negate().mul(0.12).clamp();
    const snow = p.elevation.sub(6).mul(0.16).clamp();
    const hole = p.worldPosition.x.mul(p.worldPosition.x).add(p.worldPosition.z.mul(p.worldPosition.z)).lessThan(22 * 22)
      .and(options.cube ? p.worldPosition.y.greaterThan(0) : float(1).greaterThan(0));
    const procedural = textureWeights([grass, rock, sand, snow], { hole: options.mode === "holes" ? hole : false });
    if (options.mode === "painted") {
      return options.weights ? weightMapsToControl([weightMap!], p.rootUV) : controlMapSample(controlMap!, p.rootUV);
    }
    if (options.mode === "mixed") {
      return Fn(() => {
        const painted = controlMapSample(controlMap!, p.rootUV).toVar();
        return select(decodeTextureControl(painted).auto, procedural, painted);
      })();
    }
    // BCn uses the same callback/field contract, with its four prepacked source layers.
    if (options.mode === "bcn") return textureControl({ base: 2, overlay: select(p.slope.greaterThan(0.15), float(1), float(0)), blend: p.slope.mul(4).clamp() });
    return procedural;
  }, [controlMap, weightMap, options.mode, options.weights, options.cube]);
  const getCameraOrigin = useCallback(() => ({ x: options.focusRight ? 55 : -55, y: 15, z: 0 }), [options.focusRight]);
  const terrain = useTerrain({
    rootSize: 240, maxNodes: options.capacity, maxLevel: 5, innerTileSegments: 29, skirtScale: 2,
    topology, radius: 80, elevation, texture, textureSet: assets.set,
    textureRender: options.render, textureReadback: options.readback, getCameraOrigin,
  });
  const marker = useRef<Mesh>(null);
  const reportElapsed = useRef(0);
  const centerKey = useMemo(() => new Vector3(0, 80, 0), []);
  const centerRay = useMemo(() => new Ray(new Vector3(0, 250, 0), new Vector3(0, -1, 0)), []);
  const solidRay = useMemo(() => new Ray(new Vector3(55, 250, 0), new Vector3(0, -1, 0)), []);
  useFrame((_, delta) => {
    reportElapsed.current += delta;
    if (!terrain.ready || reportElapsed.current < 0.25) return;
    reportElapsed.current = 0;
    const sample = options.cube ? terrain.runtime.surfaceQuery?.sampleTerrainByPosition(centerKey) : terrain.runtime.query?.sampleTerrain(0, 0);
    if (!sample) return;
    const centerHit = terrain.runtime.raycast?.pick(centerRay);
    const solidHit = terrain.runtime.raycast?.pick(solidRay);
    if (marker.current) {
      marker.current.visible = Boolean(solidHit);
      if (solidHit) marker.current.position.copy(solidHit.position).addScaledVector(solidHit.normal, 2);
    }
    const field = terrain.graph.peek(terrainTasks.createTextureFieldContext);
    onReport({ backend: field?.storage.backendType ?? "pending", leaves: terrain.graph.peek(terrainTasks.quadtreeUpdate)?.count ?? 0,
      control: sample.textureControl, hole: sample.hole, valid: sample.valid,
      centerRayHit: Boolean(centerHit), solidRayHit: Boolean(solidHit), layers: assets.set.slots.length,
      mips: assets.set.albedoHeight.mipmaps.length || Math.floor(Math.log2(assets.set.albedoHeight.image.width)) + 1,
      compressed: "isCompressedArrayTexture" in assets.set.albedoHeight && assets.set.albedoHeight.isCompressedArrayTexture === true,
      controlFieldId: field?.storage.texture.id ?? -1, materialArrayId: assets.set.albedoHeight.id,
    });
  });
  return <>
    <Terrain terrain={terrain} maxNodes={options.capacity} innerTileSegments={29} castShadow receiveShadow>
      {options.mode === "react" ? <TerrainStandardMaterial side={DoubleSide} /> : ({ positionNode, texture: nodes }) =>
        <meshStandardNodeMaterial positionNode={positionNode} colorNode={nodes?.albedo} normalNode={nodes?.normal}
          roughnessNode={nodes?.roughness} aoNode={nodes?.ao} side={DoubleSide} />}
    </Terrain>
    <mesh ref={marker} visible={false}><sphereGeometry args={[2, 16, 12]} /><meshStandardNodeMaterial color="#ee7038" /></mesh>
    {!options.cube && <mesh rotation-x={-Math.PI / 2} position-y={-35} receiveShadow>
      <planeGeometry args={[550, 550]} /><meshStandardNodeMaterial color="#8a4c38" />
    </mesh>}
  </>;
}

function Scene({ options, onReport, onError }: {
  options: DemoOptions; onReport: (report: DemoReport) => void; onError: (message: string) => void;
}) {
  const { renderer } = useThree();
  const [variants, setVariants] = useState<TexturingExampleAssets[] | null>(null);
  const assets = variants?.[options.mode === "react" && options.alternate ? 1 : 0];
  useEffect(() => {
    let active = true;
    const owned: TexturingExampleAssets[] = [];
    setVariants(null); onError("");
    // Keep both replacement palettes alive while this scene is mounted. The caller
    // owns sets; changing the bound set must not dispose textures still used by a frame.
    const loads = Array.from({ length: options.mode === "react" ? 2 : 1 }, (_, alternate) =>
      loadTexturingExampleAssets(renderer, { compressed: options.mode === "bcn", painted: options.mode === "painted" || options.mode === "mixed", alternate: alternate === 1 })
        .then(value => { owned.push(value); if (!active) value.dispose(); return value; }));
    void Promise.allSettled(loads).then(results => {
      if (!active) return;
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") {
        owned.forEach(value => value.dispose()); onError(String(failed.reason)); return;
      }
      setVariants(results.flatMap(result => result.status === "fulfilled" ? [result.value] : []));
    });
    return () => { active = false; owned.forEach(value => value.dispose()); };
  }, [renderer, options.mode, onError]);
  return <>
    <color attach="background" args={["#1b2630"]} />
    <hemisphereLight args={["#e7f1ff", "#786b49", 2]} />
    <directionalLight position={[-70, 180, 90]} intensity={3} castShadow
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-160} shadow-camera-right={160}
      shadow-camera-top={160} shadow-camera-bottom={-160} shadow-camera-far={500} />
    {assets && <TexturedTerrain assets={assets} options={options} onReport={onReport} />}
    <OrbitControls makeDefault minDistance={35} maxDistance={550} target={[0, 0, 0]} />
  </>;
}

function Controls({ children }: { children: React.ReactNode }) {
  const { showUI } = useExamplesCanvas();
  return showUI ? <div className="absolute left-3 top-16 z-10 max-w-[320px] rounded bg-black/75 p-3 text-xs text-white space-y-2">{children}</div> : null;
}

export default function TexturingScene({ mode = "procedural" }: { mode?: TexturingExampleMode }) {
  const [cube, setCube] = useState(false);
  const [atlasCapacity, setAtlasCapacity] = useState(false);
  const [alternate, setAlternate] = useState(false);
  const [focusRight, setFocusRight] = useState(false);
  const [weights, setWeights] = useState(false);
  const [readback, setReadback] = useState(true);
  const [collapse, setCollapse] = useState(false);
  const [fourCorners, setFourCorners] = useState(true);
  const [heightBlend, setHeightBlend] = useState(true);
  const [report, setReport] = useState<DemoReport | null>(null);
  const [error, setError] = useState("");
  const render = useMemo<TerrainTextureRenderOptions>(() => ({ corners: fourCorners ? 4 : 1, heightBlend, holes: collapse ? "collapse" : "discard" }), [fourCorners, heightBlend, collapse]);
  const options = useMemo<DemoOptions>(() => ({ mode, cube, capacity: atlasCapacity ? 1024 : 128, alternate, focusRight, weights, readback, render }),
    [mode, cube, atlasCapacity, alternate, focusRight, weights, readback, render]);
  return <ExamplesCanvas><div className="relative h-full w-full">
    <Canvas renderer={{ antialias: true, shadows: true }} camera={{ position: [160, 155, 180], near: 0.1, far: 1500, fov: 48 }} dpr={[1, 1.5]}>
      <Scene options={options} onReport={setReport} onError={setError} />
    </Canvas>
    <Controls>
      <strong className="block">{mode} · phase 1</strong>
      <label className="block"><input type="checkbox" checked={cube} onChange={e => setCube(e.target.checked)} /> Cube sphere</label>
      <label className="block"><input type="checkbox" checked={atlasCapacity} onChange={e => setAtlasCapacity(e.target.checked)} /> 1024-tile capacity (auto backend)</label>
      <label className="block"><input type="checkbox" checked={fourCorners} onChange={e => setFourCorners(e.target.checked)} /> Four-corner blending</label>
      <label className="block"><input type="checkbox" checked={heightBlend} onChange={e => setHeightBlend(e.target.checked)} /> Height blending</label>
      {mode === "painted" && <label className="block"><input type="checkbox" checked={weights} onChange={e => setWeights(e.target.checked)} /> Import PNG weights instead of native r32</label>}
      {mode === "holes" && <>
        <label className="block"><input type="checkbox" checked={collapse} onChange={e => setCollapse(e.target.checked)} /> Collapse hole triangles</label>
        <label className="block"><input type="checkbox" checked={readback} onChange={e => setReadback(e.target.checked)} /> CPU control readback</label>
      </>}
      <button className="block underline" onClick={() => setFocusRight(value => !value)}>Move LOD focus {focusRight ? "left" : "right"}</button>
      {mode === "react" && <button className="block underline" onClick={() => setAlternate(value => !value)}>Replace texture set</button>}
      {error ? <p role="alert">{error}</p> : <pre data-texturing-status={mode} className="whitespace-pre-wrap">{report ? JSON.stringify(report, null, 2) : "Loading terrain…"}</pre>}
      {mode === "holes" && <p>{readback ? "Center hole: no flat hit; on the sphere the ray reaches the solid rear surface." : "Control unavailable: CPU queries/rays are geometric only. GPU holes remain visible."}</p>}
    </Controls>
  </div></ExamplesCanvas>;
}
