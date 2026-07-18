"use client";

/**
 * Validation Gym host (spec/validation-gym.md).
 *
 * Runs gym scenarios against a real WebGPU terrain pipeline with a visible
 * viewport, evaluates behavioral invariants every frame, and exposes
 * `window.__helloTerrainGym` for the CDP runner. The pure logic (probe,
 * invariants, paths, scenarios) lives in `@hello-terrain/three`'s gym module;
 * this file only hosts it.
 */
import {
  buildGymMotionPlan,
  cameraView,
  createGymInvariantEvaluator,
  createGymProbe,
  createGymSineElevation,
  createInitialCameraView,
  elevationFn,
  GYM_SCENARIOS,
  innerTileSegments,
  maxLevel,
  maxNodes,
  placeGymProbe,
  readCameraView,
  resolveGymScenario,
  residencyAnchors,
  rootSize,
  stepGymProbe,
  TerrainMesh,
  terrainGraph,
  terrainTasks,
  type GymInvariantSummary,
  type GymScenario,
  type GymTelemetrySummary,
  type GymViolation,
} from "@hello-terrain/three";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import * as THREE from "three/webgpu";

export type GymRunResult = {
  scenario: string;
  seed: number;
  frames: number;
  fixedDtMs: number;
  platform: { userAgent: string };
  ok: boolean;
  invariants: GymInvariantSummary[];
  violations: GymViolation[];
  totalViolationCount: number;
  telemetry: GymTelemetrySummary;
  wallTimeMs: number;
};

type GymApi = {
  ready: boolean;
  listScenarios(): Array<{ name: string; description: string; defaultSeed: number }>;
  run(name?: string, options?: { seed?: number; frames?: number }): Promise<GymRunResult>;
};

declare global {
  interface Window {
    __helloTerrainGym?: GymApi;
  }
}

const PROBE_ANCHOR_RADIUS = 96;
const CAMERA_OFFSET = new THREE.Vector3(0, 48, 72);

async function runGymScenario(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  scenario: GymScenario,
  seed: number,
  frameOverride: number | undefined,
  onProgress: (frame: number, total: number) => void,
): Promise<GymRunResult> {
  const startedAt = performance.now();
  const frames = frameOverride ?? scenario.frames;
  const elevation = createGymSineElevation();
  const plan = buildGymMotionPlan(scenario, seed);
  const evaluator = createGymInvariantEvaluator(scenario.invariantOptions);
  const probe = createGymProbe(0, elevation.cpu(0, 0) + 12, 0);

  const graph = terrainGraph();
  graph.set(rootSize, () => scenario.rootSize);
  graph.set(maxNodes, () => scenario.maxNodes);
  graph.set(maxLevel, () => scenario.maxLevel);
  graph.set(innerTileSegments, () => scenario.innerTileSegments);
  graph.set(elevationFn, () => elevation.gpu);

  const mesh = new TerrainMesh({
    innerTileSegments: scenario.innerTileSegments,
    maxNodes: scenario.maxNodes,
  });
  mesh.count = 0;
  (mesh.material as THREE.MeshStandardNodeMaterial).color.set("#4d8f5a");
  const probeMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 16, 16),
    new THREE.MeshBasicMaterial({ color: "#ff4d6d" }),
  );
  scene.add(mesh, probeMarker);

  const cameraScratch = createInitialCameraView();
  let appliedPositionNode: unknown = null;
  let previous = { x: 0, z: 0 };
  const walkFrames = plan.path.length;

  try {
    for (let frame = 0; frame < frames; frame += 1) {
      // --- Motion plan: teleport, walk, or rest. ---
      let moveX = 0;
      let moveZ = 0;
      let inputsChanged = false;
      const teleportIndex =
        scenario.teleportEveryFrames && frame > 0 && frame < walkFrames
          ? Math.floor(frame / scenario.teleportEveryFrames)
          : 0;
      const isTeleportFrame =
        scenario.teleportEveryFrames !== null &&
        frame > 0 &&
        frame < walkFrames &&
        frame % scenario.teleportEveryFrames === 0 &&
        teleportIndex - 1 < plan.teleports.length;

      if (isTeleportFrame) {
        const target = plan.teleports[teleportIndex - 1]!;
        placeGymProbe(probe, target.x, elevation.cpu(target.x, target.z) + 12, target.z);
        previous = { x: target.x, z: target.z };
        inputsChanged = true;
      } else if (frame < walkFrames) {
        const point = plan.path[frame]!;
        moveX = point.x - previous.x;
        moveZ = point.z - previous.z;
        previous = point;
        inputsChanged = true;
      }

      // --- Camera follows the probe; publish per-frame params. ---
      camera.position.set(
        probe.x + moveX + CAMERA_OFFSET.x,
        probe.y + CAMERA_OFFSET.y,
        probe.z + moveZ + CAMERA_OFFSET.z,
      );
      camera.lookAt(probe.x + moveX, probe.y, probe.z + moveZ);
      camera.updateMatrixWorld();
      graph.set(cameraView, readCameraView(camera, cameraScratch));
      graph.set(residencyAnchors, [
        {
          position: { x: probe.x + moveX, y: probe.y, z: probe.z + moveZ },
          radius: PROBE_ANCHOR_RADIUS,
        },
      ]);

      await graph.run({ resources: { renderer } });

      // --- Read pipeline state, step the probe against the terrain query. ---
      const slotUpdate = graph.peek(terrainTasks.tileSlotUpdate);
      const queryContext = graph.peek(terrainTasks.terrainQuery);
      const nextX = probe.x + moveX;
      const nextZ = probe.z + moveZ;
      const sample = queryContext
        ? queryContext.query.sampleTerrain(nextX, nextZ)
        : { valid: false, elevation: 0 };
      stepGymProbe(
        probe,
        moveX,
        moveZ,
        { valid: sample.valid, elevation: sample.elevation },
        { fixedDt: scenario.fixedDt },
      );

      if (slotUpdate) {
        evaluator.evaluateFrame({
          frame,
          telemetry: slotUpdate.telemetry,
          drawRows: slotUpdate.slots.drawRows,
          drawRowCount: slotUpdate.telemetry.visibleSlotCount,
          inputsChanged,
          probe,
          trueGroundY: elevation.cpu(probe.x, probe.z),
          querySample: { valid: sample.valid, elevation: sample.elevation },
        });
      }

      // --- Visual frame: apply draw state, render, yield. ---
      const leafBuffer = graph.peek(terrainTasks.leafGpuBuffer);
      if (leafBuffer) {
        mesh.count = leafBuffer.count;
        mesh.instanceMatrix.needsUpdate = true;
      }
      const positionNode = graph.peek(terrainTasks.positionNode);
      if (positionNode && positionNode !== appliedPositionNode) {
        const material = mesh.material as THREE.MeshStandardNodeMaterial;
        material.positionNode = positionNode;
        material.needsUpdate = true;
        appliedPositionNode = positionNode;
      }
      probeMarker.position.set(probe.x, probe.y, probe.z);
      renderer.render(scene, camera);
      onProgress(frame + 1, frames);
      await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    }

    const outcome = evaluator.finish();
    return {
      scenario: scenario.name,
      seed,
      frames,
      fixedDtMs: scenario.fixedDt * 1000,
      platform: { userAgent: navigator.userAgent },
      ok: outcome.ok,
      invariants: outcome.invariants,
      violations: outcome.violations,
      totalViolationCount: outcome.totalViolationCount,
      telemetry: outcome.telemetry,
      wallTimeMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    scene.remove(mesh, probeMarker);
    mesh.geometry.dispose();
    probeMarker.geometry.dispose();
    (probeMarker.material as THREE.Material).dispose();
    graph.dispose();
  }
}

export function GymLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGPURenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const runningRef = useRef(false);

  const [status, setStatus] = useState("initializing");
  const [progress, setProgress] = useState<{ frame: number; total: number } | null>(null);
  const [scenarioName, setScenarioName] = useState<string>(GYM_SCENARIOS[0]!.name);
  const [seedText, setSeedText] = useState<string>(String(GYM_SCENARIOS[0]!.defaultSeed));
  const [result, setResult] = useState<GymRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo<GymApi>(
    () => ({
      ready: false,
      listScenarios: () =>
        GYM_SCENARIOS.map(({ name, description, defaultSeed }) => ({
          name,
          description,
          defaultSeed,
        })),
      async run(name, options) {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (!renderer || !scene || !camera) throw new Error("Gym renderer is not ready.");
        if (runningRef.current) throw new Error("A gym scenario is already running.");
        const scenario = resolveGymScenario(name ?? GYM_SCENARIOS[0]!.name);
        const seed = options?.seed ?? scenario.defaultSeed;
        runningRef.current = true;
        setStatus(`running ${scenario.name} (seed ${seed})`);
        setError(null);
        setScenarioName(scenario.name);
        setSeedText(String(seed));
        try {
          const runResult = await runGymScenario(
            renderer,
            scene,
            camera,
            scenario,
            seed,
            options?.frames,
            (frame, total) => setProgress({ frame, total }),
          );
          setResult(runResult);
          setStatus(runResult.ok ? "ok" : "violations");
          return runResult;
        } catch (runError) {
          const message = runError instanceof Error ? runError.message : String(runError);
          setError(message);
          setStatus("error");
          throw runError;
        } finally {
          runningRef.current = false;
          setProgress(null);
        }
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let renderer: THREE.WebGPURenderer | null = null;

    window.__helloTerrainGym = api;

    async function init() {
      if (!canvas) return;
      if (!navigator.gpu) {
        setStatus("webgpu-unavailable");
        return;
      }
      renderer = new THREE.WebGPURenderer({
        canvas,
        antialias: true,
      } as WebGPURendererParameters);
      renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 450, false);
      await renderer.init();
      if (disposed) {
        renderer.dispose();
        return;
      }

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#10151d");
      scene.add(new THREE.AmbientLight(0xffffff, 0.35));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(0.6, 1, 0.4);
      scene.add(sun);

      const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 20000);

      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      api.ready = true;
      setStatus("ready");

      const params = new URLSearchParams(window.location.search);
      const scenarioParam = params.get("scenario");
      const seedParam = params.get("seed");
      if (scenarioParam) setScenarioName(scenarioParam);
      if (seedParam) setSeedText(seedParam);
      if (params.get("autorun") === "1" && scenarioParam) {
        void api.run(scenarioParam, seedParam ? { seed: Number(seedParam) } : undefined);
      }
    }

    void init().catch((initError) => {
      setStatus("error");
      setError(initError instanceof Error ? initError.message : String(initError));
    });

    return () => {
      disposed = true;
      api.ready = false;
      rendererRef.current = null;
      if (window.__helloTerrainGym === api) window.__helloTerrainGym = undefined;
      renderer?.dispose();
    };
  }, [api]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <p className="text-sm uppercase tracking-wide text-sky-300">Validation Gym</p>
          <h1 className="mt-2 text-3xl font-bold">Behavioral correctness scenarios</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-300">
            Seeded scenarios drive a kinematic probe over a real WebGPU terrain while invariants
            (coverage, readiness, drainage, grounding vs analytic truth, stability) are asserted
            every frame. Automatable via{" "}
            <code className="mx-1 rounded bg-neutral-800 px-1 py-0.5">
              window.__helloTerrainGym.run(name, {"{ seed }"})
            </code>
            — see <code>spec/validation-gym.md</code>.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <section className="rounded border border-neutral-800 bg-neutral-900 p-3">
            <canvas ref={canvasRef} className="aspect-video w-full rounded bg-black" />
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <select
                className="rounded bg-neutral-800 px-2 py-1.5"
                value={scenarioName}
                onChange={(event) => {
                  setScenarioName(event.target.value);
                  setSeedText(String(resolveGymScenario(event.target.value).defaultSeed));
                }}
              >
                {GYM_SCENARIOS.map((scenario) => (
                  <option key={scenario.name} value={scenario.name}>
                    {scenario.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2">
                seed
                <input
                  className="w-24 rounded bg-neutral-800 px-2 py-1.5 font-mono"
                  value={seedText}
                  onChange={(event) => setSeedText(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded bg-sky-500 px-4 py-1.5 font-bold text-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                disabled={status === "initializing" || runningRef.current}
                onClick={() => {
                  void api.run(scenarioName, { seed: Number(seedText) || 0 }).catch(() => {});
                }}
              >
                Run
              </button>
              <span className="font-mono text-neutral-400">
                {progress ? `${progress.frame}/${progress.total}` : status}
              </span>
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              {resolveGymScenario(scenarioName).description}
            </p>
            {error ? (
              <pre className="mt-2 whitespace-pre-wrap text-xs text-red-300">{error}</pre>
            ) : null}
          </section>

          <section className="flex flex-col gap-3">
            <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
              <div className="mb-2 text-sm text-neutral-400">Invariants</div>
              {result ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {result.invariants.map((invariant) => (
                    <li key={invariant.name} className="flex items-center justify-between">
                      <span className="font-mono">{invariant.name}</span>
                      <span
                        className={
                          invariant.pass ? "font-bold text-emerald-400" : "font-bold text-red-400"
                        }
                      >
                        {invariant.pass ? "pass" : `${invariant.violationCount}×`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-neutral-500">No run yet.</div>
              )}
            </div>

            <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
              <div className="mb-2 text-sm text-neutral-400">
                Violations{result ? ` (${result.totalViolationCount})` : ""}
              </div>
              <div className="max-h-56 overflow-auto">
                {result && result.violations.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-xs">
                    {result.violations.map((violation, index) => (
                      <li key={index} className="font-mono text-red-300">
                        [{violation.frame}] {violation.invariant}: {violation.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-neutral-500">
                    {result ? "None." : "Awaiting run."}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
              <div className="mb-2 text-sm text-neutral-400">Run summary</div>
              <pre className="max-h-64 overflow-auto text-xs leading-5 text-neutral-200">
                {result
                  ? JSON.stringify(
                      { ok: result.ok, telemetry: result.telemetry, wallTimeMs: result.wallTimeMs },
                      null,
                      2,
                    )
                  : "Awaiting run."}
              </pre>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
