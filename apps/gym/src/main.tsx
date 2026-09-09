import React, { useLayoutEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Canvas, useThree, type RootState } from "@react-three/fiber";
import { Terrain, useTerrain, type TerrainHandle } from "@hello-terrain/react";
import {
  createCubeSphereTopology,
  createTorusTopology,
  elevationFn,
  terrainTasks,
  type ElevationCallback,
} from "@hello-terrain/three";
import { normalWorld, positionWorld, vec4 } from "three/tsl";
import {
  DoubleSide,
  FloatType,
  LinearSRGBColorSpace,
  MeshBasicNodeMaterial,
  NoToneMapping,
  OrthographicCamera,
  RenderTarget,
  WebGPURenderer,
  Vector3,
} from "three/webgpu";
import {
  analyticElevation,
  analyticNormal,
  elevationTolerance,
  scenarioPartitionAssertions,
  surfaceProbes,
  surfaceReference,
  surfaceTolerances,
  numericAssertion,
  type Assertion,
  type Leaf,
} from "../../../packages/three/gym/oracles";
import {
  cameraPose,
  getScenario,
  probePoints,
  type AnalyticField,
  type GymMode,
  type Pose,
} from "../../../packages/three/gym/scenarios";
import { summarize, type GymResult } from "../../../packages/three/gym/report";
import { runPrecision } from "./precision";
import { runSkirts } from "./skirts";
import { runAuthoring } from "./authoring";

export type BrowserOptions = {
  scenario: string;
  seed: number;
  mode: GymMode;
  duration: number;
  warmup: number;
  checkpoint?: string;
  fault?: string;
};
declare global {
  interface Window {
    runGym: (options: BrowserOptions) => Promise<GymResult>;
  }
}

function elevationCallback(field: AnalyticField): ElevationCallback {
  return ({ worldPosition }) =>
    worldPosition.x.mul(field.slopeX).add(worldPosition.z.mul(field.slopeZ)).add(field.offset);
}

function copyLeaves(terrain: TerrainHandle): Leaf[] {
  const leaves = terrain.graph.peek(terrainTasks.quadtreeUpdate);
  return leaves
    ? Array.from({ length: leaves.count }, (_, i) => ({
        space: leaves.space[i],
        level: leaves.level[i],
        x: leaves.x[i],
        y: leaves.y[i],
      }))
    : [];
}

function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeImage(width: number, height: number, bytes: Uint8ClampedArray): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext("2d")!
    .putImageData(new ImageData(bytes as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

async function runBrowser(options: BrowserOptions): Promise<GymResult> {
  const result: GymResult = { status: "passed", assertions: [], metrics: {}, samples: [] };
  if (!navigator.gpu || options.fault === "unsupported")
    return {
      ...result,
      status: "unsupported",
      error: "WebGPU unavailable (or explicitly simulated)",
    };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { ...result, status: "unsupported", error: "No WebGPU adapter" };
  const info = adapter.info;
  const software =
    adapter.info.isFallbackAdapter ||
    /swiftshader|llvmpipe|software/i.test(
      `${info.vendor} ${info.architecture} ${info.description}`,
    );
  result.capabilities = {
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
    },
    hardware: !software && Boolean(info.vendor || info.device),
    software,
    features: [...adapter.features].sort(),
    limits: Object.fromEntries(
      [
        "maxBufferSize",
        "maxStorageBufferBindingSize",
        "maxComputeWorkgroupSizeX",
        "maxComputeInvocationsPerWorkgroup",
      ].map((key) => [key, adapter.limits[key as keyof GPUSupportedLimits]]),
    ),
    timestampQuery: adapter.features.has("timestamp-query"),
    gpuTiming:
      "unavailable: per-window attribution not implemented; task elapsed time is not GPU time",
    resourceAccounting: "renderer memory counters only; not a GPU ownership/leak proof",
    driver: "production shared runtime via useTerrain + Terrain, driven by Fiber advance",
  };
  const scenario = getScenario(options.scenario);
  if (scenario.id === "terrain-skirts") return runSkirts(result.capabilities);
  if (scenario.id === "earth-precision") return runPrecision(result.capabilities);
  if (scenario.id === "material-authoring") return runAuthoring(result.capabilities);
  const started = performance.now();
  let state: RootState | undefined;
  let renderer: WebGPURenderer | undefined;
  let frame = 0;
  let runsStarted = 0;
  let runsFinished = 0;
  let inFlight = 0;
  let recording = false;
  const handles = new Map<string, TerrainHandle>();
  const events: unknown[] = [];
  const errors: string[] = [];
  const taskDurations: number[] = [];
  const root = createRoot(document.getElementById("root")!);
  let peer = options.scenario === "instance-isolation";
  const onError = (event: ErrorEvent) => errors.push(event.message);
  const onRejection = (event: PromiseRejectionEvent) => errors.push(String(event.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  function Fixture({ id, x }: { id: string; x: number }) {
    const field = id === "primary" ? scenario.initial : { offset: 20, slopeX: 0, slopeZ: 0 };
    const elevation = useMemo(() => elevationCallback(field), []);
    const origin = useMemo(() => ({ x, y: 0, z: 0 }), [x]);
    const topology = useMemo(
      () =>
        scenario.shape === "cubeSphere"
          ? createCubeSphereTopology({ radius: scenario.radius })
          : scenario.shape === "torus"
            ? createTorusTopology({
                majorRadius: scenario.majorRadius,
                minorRadius: scenario.minorRadius,
              })
            : null,
      [],
    );
    const terrain = useTerrain({
      ...scenario,
      topology,
      origin,
      elevation,
      skirtScale: 0,
      elevationScale: 1,
    });
    const get = useThree((s) => s.get);
    const material = useMemo(() => {
      const value = new MeshBasicNodeMaterial({ side: DoubleSide });
      value.color.setRGB(0.3, 0.7, 0.45);
      return value;
    }, []);
    useLayoutEffect(() => {
      state = get();
      handles.set(id, terrain);
    });
    useLayoutEffect(() => {
      const unsubscribe = terrain.graph.on((event) => {
        if (event.type === "run:start") {
          runsStarted++;
          inFlight++;
        }
        if (event.type === "run:finish") {
          runsFinished++;
          inFlight--;
          if (event.status === "error") errors.push(`${id}: graph run failed`);
        }
        if (event.type === "task:error") errors.push(`${id}: task failed: ${event.taskId}`);
        if (recording && event.type === "task:finish") taskDurations.push(event.durationMs);
        if (recording && events.length < 20000) events.push({ instance: id, frame, ...event });
      });
      return () => {
        unsubscribe();
        handles.delete(id);
        material.dispose();
      };
    }, [terrain.graph]);
    return (
      <Terrain
        name={`gym-${id}`}
        terrain={terrain}
        maxNodes={scenario.maxNodes}
        innerTileSegments={scenario.innerTileSegments}
      >
        {({ positionNode }) => {
          material.positionNode = positionNode;
          return <primitive object={material} attach="material" />;
        }}
      </Terrain>
    );
  }

  const mount = () =>
    root.render(
      <>
        <div style={{ padding: 12 }}>
          Terrain gym · {scenario.id} · {options.mode}
        </div>
        <Canvas
          frameloop="never"
          dpr={1}
          style={{ width: 640, height: 480 }}
          camera={{ position: [0, 48, 27], near: 0.1, far: 1000 }}
          gl={async (props) => {
            renderer = new WebGPURenderer({
              canvas: props.canvas as HTMLCanvasElement,
              antialias: false,
              forceWebGL: false,
            });
            renderer.outputColorSpace = LinearSRGBColorSpace;
            renderer.toneMapping = NoToneMapping;
            await renderer.init();
            if (!(renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend)
              throw new Error("Unexpected WebGL fallback");
            const device = (renderer.backend as unknown as { device: GPUDevice }).device;
            const actualInfo = device.adapterInfo;
            if (actualInfo) {
              const actualSoftware =
                actualInfo.isFallbackAdapter ||
                /swiftshader|llvmpipe|software/i.test(
                  `${actualInfo.vendor} ${actualInfo.architecture} ${actualInfo.description}`,
                );
              Object.assign(result.capabilities!, {
                adapter: {
                  vendor: actualInfo.vendor,
                  architecture: actualInfo.architecture,
                  device: actualInfo.device,
                  description: actualInfo.description,
                },
                hardware: !actualSoftware && Boolean(actualInfo.vendor || actualInfo.device),
                software: actualSoftware,
              });
            } else {
              result.capabilities!.hardware = false;
              result.capabilities!.adapterIdentity =
                "Probed adapter only; runtime adapter identity unavailable";
            }
            result.capabilities!.deviceFeatures = [...device.features].sort();
            result.capabilities!.deviceLimits = Object.fromEntries(
              [
                "maxBufferSize",
                "maxStorageBufferBindingSize",
                "maxTextureArrayLayers",
                "maxComputeInvocationsPerWorkgroup",
              ].map((key) => [key, device.limits[key as keyof GPUSupportedLimits]]),
            );
            device.addEventListener("uncapturederror", (event) => errors.push(event.error.message));
            void device.lost.then((lost) => {
              if (lost.reason !== "destroyed") errors.push(`GPU device lost: ${lost.message}`);
            });
            return renderer;
          }}
        >
          <Fixture id="primary" x={0} />
          {peer && <Fixture id="peer" x={128} />}
        </Canvas>
      </>,
    );

  async function waitFor(predicate: () => boolean, label: string, timeout = 15000) {
    const until = performance.now() + timeout;
    while (!predicate()) {
      if (errors.length) throw new Error(errors.join("\n"));
      if (performance.now() > until) throw new Error(`Timed out: ${label}`);
      await sleep(5);
    }
  }
  function applyPose(pose: Pose) {
    state!.camera.position.set(pose.x, pose.y, pose.z);
    state!.camera.lookAt(0, 0, 0);
    state!.camera.updateMatrixWorld();
  }
  function advance() {
    frame++;
    state!.advance(performance.now() / 1000);
  }
  async function step() {
    advance();
    await waitFor(() => inFlight === 0, "production graph completion");
    await sleep(); // Let React publish nodes and the asynchronous CPU mirror progress.
  }

  function queryAssertions(field: AnalyticField, checkpoint: string): Assertion[] {
    if (scenario.shape !== "flat") {
      const query = handles.get("primary")!.runtime.surfaceQuery;
      return surfaceProbes(scenario).flatMap((point) => {
        const position = new Vector3(...(point as [number, number, number]));
        const sample = query?.sampleTerrainByPosition(position);
        const reference = surfaceReference(scenario, point);
        const expectedPosition = point.map((v, axis) => v + reference.normal[axis] * field.offset);
        const level = query?.getTileByPosition(position)?.level ?? 0;
        return [
          numericAssertion(
            checkpoint,
            "surface-query-elevation",
            sample?.valid ? sample.elevation : null,
            field.offset,
            elevationTolerance(field, scenario.rootSize, false),
            point,
          ),
          ...expectedPosition.map((value, axis) =>
            numericAssertion(
              checkpoint,
              `surface-query-position-${axis}`,
              sample?.valid ? sample.position.getComponent(axis) : null,
              value,
              1e-4,
              point,
            ),
          ),
          ...reference.normal.map((value, axis) =>
            numericAssertion(
              checkpoint,
              `surface-query-normal-${axis}`,
              sample?.valid ? sample.normal.getComponent(axis) : null,
              value,
              surfaceTolerances(scenario, field, level).normal,
              point,
            ),
          ),
        ];
      });
    }
    const query = handles.get("primary")!.runtime.query;
    const expectedNormal = analyticNormal(field);
    return probePoints(options.seed).flatMap(([x, z]) => {
      const normal = query?.getNormal(x, z);
      const bounds = query?.getTileBounds(x, z);
      const expectedElevation = analyticElevation(field, x, z);
      return [
        numericAssertion(
          checkpoint,
          "query-elevation",
          query?.getElevation(x, z) ?? null,
          analyticElevation(field, x, z),
          elevationTolerance(field, scenario.rootSize, false),
          [x, z],
        ),
        {
          checkpoint,
          name: "conservative-query-bounds",
          coordinates: [x, z],
          actual: bounds ? [bounds.minElevation, bounds.maxElevation] : null,
          expected: `contains ${expectedElevation}`,
          pass: Boolean(
            bounds &&
            bounds.minElevation <=
              expectedElevation + elevationTolerance(field, scenario.rootSize, false) &&
            bounds.maxElevation >=
              expectedElevation - elevationTolerance(field, scenario.rootSize, false),
          ),
        },
        ...expectedNormal.map((value, axis) =>
          numericAssertion(
            checkpoint,
            `query-normal-${axis}`,
            normal ? [normal.x, normal.y, normal.z][axis] : null,
            value,
            // Central differences are exact for a linear fixture apart from float32 cancellation.
            (64 * 2 ** -23 * (Math.abs(field.offset) + scenario.rootSize)) /
              (scenario.rootSize / 2 ** scenario.maxLevel / scenario.innerTileSegments),
            [x, z],
          ),
        ),
      ];
    });
  }

  async function inspectGpu(field: AnalyticField, checkpoint: string) {
    const terrain = handles.get("primary")!;
    const leaves = copyLeaves(terrain);
    result.assertions.push(...scenarioPartitionAssertions(scenario, leaves, checkpoint));
    const context = terrain.graph.peek(terrainTasks.createElevationFieldContext)!;
    const raw = new Float32Array(await renderer!.getArrayBufferAsync(context.attribute));
    const width = scenario.innerTileSegments + 3;
    for (let i = 0; i < Math.min(leaves.length, 16); i++) {
      const tile = leaves[i];
      const spacing = scenario.rootSize / 2 ** tile.level / scenario.innerTileSegments;
      const ix = 3,
        iz = 4;
      const x = (tile.x * scenario.innerTileSegments + ix - 1) * spacing - scenario.rootSize / 2;
      const z = (tile.y * scenario.innerTileSegments + iz - 1) * spacing - scenario.rootSize / 2;
      result.assertions.push(
        numericAssertion(
          checkpoint,
          "gpu-elevation",
          raw[i * width * width + iz * width + ix],
          analyticElevation(field, x, z),
          elevationTolerance(field, scenario.rootSize, false),
          [x, z],
        ),
      );
    }

    // Render the actual Terrain mesh with its production position node into a
    // float diagnostic target. This observes packed-field consumption and mesh
    // assembly independently of CPU queries and raw elevation readback.
    const target = new RenderTarget(32, 32, { type: FloatType, depthBuffer: true });
    const extent = scenario.shape === "torus" ? 32 : 16;
    const camera = new OrthographicCamera(-extent, extent, extent, -extent, 0.1, 200);
    camera.position.set(0, 100, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const oldTarget = renderer!.getRenderTarget();
    const saved: {
      material: MeshBasicNodeMaterial;
      output: MeshBasicNodeMaterial["outputNode"];
    }[] = [];
    state!.scene.traverse((object) => {
      const material = (object as unknown as { material?: MeshBasicNodeMaterial }).material;
      if (!material?.isMeshBasicNodeMaterial) return;
      saved.push({ material, output: material.outputNode });
      material.outputNode = vec4(positionWorld, 1);
      material.needsUpdate = true;
    });
    try {
      renderer!.setRenderTarget(target);
      renderer!.setClearColor(0, 0);
      renderer!.clear();
      await renderer!.renderAsync(state!.scene, camera);
      const pixels = await renderer!.readRenderTargetPixelsAsync(target, 0, 0, 32, 32);
      if (!(pixels instanceof Float32Array))
        throw new Error("Float render readback is unsupported");
      const debug = new Uint8ClampedArray(32 * 32 * 4);
      for (let i = 0; i < 32 * 32; i++) {
        // Fixed display range [-4, 12], solely for the diagnostic image. Numeric
        // assertions use the original float values, never these display colors.
        const elevation = Math.max(0, Math.min(1, (pixels[i * 4 + 1] + 4) / 16));
        debug.set([elevation * 255, (1 - elevation) * 180, 120, pixels[i * 4 + 3] * 255], i * 4);
      }
      (result.images ??= []).push({
        name: `${checkpoint}-elevation`,
        dataUrl: encodeImage(32, 32, debug),
      });
      const pixelProbes =
        scenario.shape === "torus"
          ? [
              [26, 16],
              [16, 26],
              [5, 16],
              [16, 5],
              [24, 24],
            ]
          : [
              [8, 8],
              [16, 16],
              [24, 24],
              [8, 24],
              [24, 8],
            ];
      for (const [px, py] of pixelProbes) {
        const offset = (py * 32 + px) * 4;
        const [x, y, z, alpha] = pixels.slice(offset, offset + 4);
        result.assertions.push(
          numericAssertion(checkpoint, "render-coverage", alpha, 1, 0, [px, py]),
        );
        // One world unit per pixel. Allow 1/16 pixel for rasterizer subpixel
        // vertex snapping; field accuracy is checked at the observed world XZ.
        result.assertions.push(
          numericAssertion(
            checkpoint,
            "render-world-x",
            x,
            ((px + 0.5) * extent) / 16 - extent,
            extent / 256,
            [px, py],
          ),
        );
        result.assertions.push(
          numericAssertion(
            checkpoint,
            "render-world-z",
            z,
            ((py + 0.5) * extent) / 16 - extent,
            extent / 256,
            [px, py],
          ),
        );
        result.assertions.push(
          numericAssertion(
            checkpoint,
            "render-elevation",
            (scenario.shape === "flat" ? y : surfaceReference(scenario, [x, y, z]).elevation) +
              (options.fault === "render" ? 1 : 0),
            scenario.shape === "flat" ? analyticElevation(field, x, z) : field.offset,
            scenario.shape === "flat"
              ? elevationTolerance(field, scenario.rootSize, true)
              : surfaceTolerances(
                  scenario,
                  field,
                  terrain.runtime.surfaceQuery?.getTileByPosition(new Vector3(x, y, z))?.level ?? 0,
                ).position,
            [x, z],
          ),
        );
      }
      for (const { material } of saved) {
        material.outputNode = vec4(normalWorld, 1);
        material.needsUpdate = true;
      }
      await renderer!.renderAsync(state!.scene, camera);
      const normals = await renderer!.readRenderTargetPixelsAsync(target, 0, 0, 32, 32);
      const expectedNormal = analyticNormal(field);
      const normalTolerance =
        2 ** -8 +
        (64 * 2 ** -23 * (Math.abs(field.offset) + scenario.rootSize)) /
          (scenario.rootSize / 2 ** scenario.maxLevel / scenario.innerTileSegments);
      for (const [px, py] of pixelProbes.slice(0, 3))
        for (let axis = 0; axis < 3; axis++) {
          const world = Array.from(pixels.slice((py * 32 + px) * 4, (py * 32 + px) * 4 + 3));
          const expected =
            scenario.shape === "flat" ? expectedNormal : surfaceReference(scenario, world).normal;
          result.assertions.push(
            numericAssertion(
              checkpoint,
              `render-normal-${axis}`,
              normals[(py * 32 + px) * 4 + axis],
              expected[axis],
              scenario.shape === "flat"
                ? normalTolerance
                : surfaceTolerances(
                    scenario,
                    field,
                    terrain.runtime.surfaceQuery?.getTileByPosition(
                      new Vector3(...(world as [number, number, number])),
                    )?.level ?? 0,
                  ).normal,
              [px, py],
            ),
          );
        }
    } finally {
      for (const { material, output } of saved) {
        material.outputNode = output;
        material.needsUpdate = true;
      }
      renderer!.setRenderTarget(oldTarget);
      renderer!.setClearColor(0x18202a, 1);
      target.dispose();
    }
    result.samples.push({
      checkpoint,
      frame,
      leaves,
      queryGeneration: terrain.runtime.query?.generation,
      graph: terrain.graph.inspect(),
    });
  }

  async function captureRenderedView() {
    const target = new RenderTarget(640, 480);
    const previous = renderer!.getRenderTarget();
    try {
      renderer!.setRenderTarget(target);
      await renderer!.renderAsync(state!.scene, state!.camera);
      const bytes = await renderer!.readRenderTargetPixelsAsync(target, 0, 0, 640, 480);
      const dataUrl = encodeImage(
        640,
        480,
        new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      (result.images ??= []).push({ name: "render", dataUrl });
      // Some headless compositors omit WebGPU canvases in screenshots. Display
      // the actual GPU readback, also saved separately by the runner.
      const preview = document.createElement("img");
      preview.src = dataUrl;
      preview.alt = "Terrain render read back from WebGPU";
      preview.style.cssText = "position:absolute;left:0;top:42px;width:640px;height:480px";
      document.body.appendChild(preview);
    } finally {
      renderer!.setRenderTarget(previous);
      target.dispose();
    }
  }

  async function checkpoint(field: AnalyticField, name: string) {
    const begin = performance.now();
    let observations: Assertion[] = [];
    do {
      await step();
      observations = queryAssertions(field, name);
      if (observations.every((entry) => entry.pass)) break;
    } while (performance.now() - begin < 5000);
    result.metrics[`${name}.queryLatencyMs`] = performance.now() - begin;
    result.assertions.push(...observations);
    await step(); // Mesh synchronization follows the graph's publication.
    await inspectGpu(field, name);
    if (errors.length) throw new Error(errors.join("\n"));
  }

  try {
    mount();
    await waitFor(
      () => Boolean(state && renderer && handles.has("primary")),
      "React/WebGPU initialization",
      30000,
    );
    applyPose(cameraPose(0));
    await checkpoint(scenario.initial, "initial");
    result.metrics.coldFirstResultMs = performance.now() - started;
    if (options.mode === "probe") {
      result.capabilities!.productionDriverVerified = result.assertions.every((a) => a.pass);
    } else if (options.checkpoint !== "initial") {
      // No artificial camera nudge: a stationary edit must become observable.
      handles.get("primary")!.controller.configure({ elevation: elevationCallback(scenario.edited) });
      await checkpoint(scenario.edited, "stationary-edit");
      if (options.checkpoint !== "stationary-edit" && options.mode !== "perf") {
        for (let i = 0; i < (scenario.id === "flat-lod" ? 12 : 3); i++) {
          applyPose(cameraPose(i / 11));
          await checkpoint(scenario.edited, `pose-${i}`);
        }
        if (peer) {
          const a = handles.get("primary")!.graph.peek(terrainTasks.updateUniforms)!;
          const b = handles.get("peer")!.graph.peek(terrainTasks.updateUniforms)!;
          result.assertions.push({
            checkpoint: "two-instances",
            name: "independent-origin-uniforms",
            actual: a.uRootOrigin.value === b.uRootOrigin.value,
            expected: false,
            pass: a.uRootOrigin.value !== b.uRootOrigin.value,
          });
          result.assertions.push(
            numericAssertion(
              "two-instances",
              "peer-query",
              handles.get("peer")!.runtime.query?.getElevation(128, 0) ?? null,
              20,
              0.001,
            ),
          );
          await waitFor(() => inFlight === 0, "before unmount");
          peer = false;
          flushSync(mount);
          await sleep();
          await checkpoint(scenario.edited, "survivor-after-unmount");
        }
      }
      if (options.mode === "perf") {
        // Warm the real render path, then measure continuous Fiber frames with
        // the production hook free to skip frames while its graph is in flight.
        const frameSamples: {
          t: number;
          intervalMs: number;
          pose: Pose;
          applied: boolean;
          leaves: number;
          renderedInstances: number;
          levels: Record<number, number>;
          queryGeneration: number | null;
          snapshotPublicationAgeMs: number;
        }[] = [];
        const begin = performance.now();
        let previous = begin;
        let firstMeasured: number | undefined;
        let missed = 0;
        let lastGeneration = handles.get("primary")!.runtime.query?.generation ?? null;
        let publicationAt = begin;
        const runsBefore = runsFinished;
        let observedLeaves = copyLeaves(handles.get("primary")!);
        while (performance.now() - begin < options.warmup + options.duration) {
          const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
          const elapsed = now - begin;
          const pose = cameraPose(elapsed / 4000);
          // Capture published observations before the next input invalidates
          // graph.peek(). An in-flight graph is not a zero-leaf terrain.
          const terrain = handles.get("primary")!;
          if (terrain.graph.peek(terrainTasks.quadtreeUpdate)) observedLeaves = copyLeaves(terrain);
          const generation = terrain.runtime.query?.generation ?? null;
          const levels: Record<number, number> = {};
          for (const leaf of observedLeaves) levels[leaf.level] = (levels[leaf.level] ?? 0) + 1;
          applyPose(pose);
          recording = elapsed >= options.warmup;
          const before = runsStarted;
          advance();
          if (recording) {
            firstMeasured ??= now;
            const applied = runsStarted > before;
            if (!applied) missed++;
            if (generation !== lastGeneration) {
              publicationAt = now;
              lastGeneration = generation;
            }
            frameSamples.push({
              t: elapsed,
              intervalMs: now - previous,
              pose,
              applied,
              leaves: observedLeaves.length,
              renderedInstances:
                (state!.scene.getObjectByName("gym-primary") as unknown as { count?: number })
                  ?.count ?? 0,
              levels,
              queryGeneration: generation,
              snapshotPublicationAgeMs: now - publicationAt,
            });
          }
          previous = now;
        }
        recording = false;
        await waitFor(() => inFlight === 0, "final graph completion");
        const timing = summarize(frameSamples.slice(1).map((s) => s.intervalMs));
        Object.assign(result.metrics, {
          frameMedianMs: timing.median,
          frameP95Ms: timing.p95,
          frameP99Ms: timing.p99,
          measuredFrames: frameSamples.length,
          missedFrames: missed,
          completedRunsIncludingWarmup: runsFinished - runsBefore,
          taskMedianMs: summarize(taskDurations).median,
          maxLeaves: Math.max(0, ...frameSamples.map((s) => s.leaves)),
          maxRenderedInstances: Math.max(0, ...frameSamples.map((s) => s.renderedInstances)),
          snapshotPublicationAgeP95Ms: summarize(
            frameSamples.map((s) => s.snapshotPublicationAgeMs),
          ).p95,
          gpuComputeMs: null,
          gpuRenderMs: null,
          measuredDurationMs: firstMeasured === undefined ? 0 : previous - firstMeasured,
        });
        result.samples.push({
          performance: frameSamples,
          graphEvents: events,
          eventsTruncated: events.length === 20000,
        });
        result.assertions.push({
          checkpoint: "performance",
          name: "observed-terrain-workload",
          pass:
            frameSamples.length > 0 &&
            frameSamples.every((s) => s.leaves > 0 && s.renderedInstances > 0),
          actual: {
            frames: frameSamples.length,
            minLeaves: Math.min(...frameSamples.map((s) => s.leaves)),
            minRenderedInstances: Math.min(...frameSamples.map((s) => s.renderedInstances)),
          },
          expected: "nonempty published and rendered terrain throughout the measured window",
        });
        await checkpoint(scenario.edited, "after-performance");
      }
    }
    result.metrics.finalLeaves = copyLeaves(handles.get("primary")!).length;
    result.samples.push({
      rendererMemory: { ...renderer!.info.memory },
      note: "Renderer counters include shared caches; these are not measured VRAM or owned-resource totals.",
    });
    result.assertions.push({
      checkpoint: "runtime",
      name: "no-browser-or-gpu-errors",
      actual: errors,
      expected: [],
      pass: errors.length === 0,
    });
    result.status = result.assertions.every((a) => a.pass) ? "passed" : "failed";
    await step();
    await captureRenderedView();
    return result;
  } catch (error) {
    if (errors.length)
      result.assertions.push({
        checkpoint: "runtime",
        name: "no-browser-or-gpu-errors",
        actual: errors,
        expected: [],
        pass: false,
      });
    return {
      ...result,
      status: errors.length ? "failed" : "error",
      error: error instanceof Error ? error.stack : String(error),
    };
  } finally {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    // The page stays visible for the runner's screenshot. Each run gets a fresh
    // browser context; page teardown is containment, never evidence of cleanup.
  }
}

function initialize() {
  window.runGym = runBrowser;
  document.getElementById("root")!.innerHTML =
    "<p style='padding:16px'>Terrain gym ready. Run pnpm gym, or open a replay URL from a report.</p>";
  const params = new URLSearchParams(location.search);
  if (params.has("scenario")) {
    void runBrowser({
      scenario: params.get("scenario")!,
      seed: Number(params.get("seed") ?? 7),
      mode: "check",
      duration: 4000,
      warmup: 1000,
    }).then((result) => {
      const summary = document.createElement("pre");
      summary.textContent = JSON.stringify(
        {
          status: result.status,
          error: result.error,
          failures: result.assertions.filter((a) => !a.pass),
          metrics: result.metrics,
        },
        null,
        2,
      );
      document.body.appendChild(summary);
    });
  }
}
initialize();
