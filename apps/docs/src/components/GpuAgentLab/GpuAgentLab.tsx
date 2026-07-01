"use client";

import {
  cameraView,
  createCubeSphereTopology,
  createTorusTopology,
  elevationFn,
  elevationScale,
  getDeviceComputeLimits,
  innerTileSegments,
  lodCriteria,
  maxLevel,
  maxNodes,
  origin,
  radius,
  rootSize,
  skirtScale,
  terrainFieldFilter,
  terrainGraph,
  terrainTasks,
  topology,
  type ElevationCallback,
  type TerrainGraph,
  type TerrainQueryContext,
  type Topology,
} from "@hello-terrain/three";
import type { GraphEvent, RunReport } from "@hello-terrain/work";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import { cos, float, sin } from "three/tsl";
import * as THREE from "three/webgpu";

type AgentScenarioName =
  | "flat-sine-smoke"
  | "flat-zero-smoke"
  | "earth-sphere-load"
  | "earth-sphere-surface-load"
  | "earth-sphere-orbit-surface-center"
  | "earth-sphere-orbit-surface-edge"
  | "earth-sphere-orbit-surface-corner"
  | "earth-torus-surface-load"
  | "earth-torus-load";

type ScenarioSurfaceKind = "flat" | "sphere" | "torus";
type ScenarioCameraPathKind = "static" | "orbit-surface";
type OrbitSurfacePreset = "center" | "edge" | "corner";

type ScenarioSamplePoint =
  | {
      kind: "flat";
      label: string;
      x: number;
      z: number;
    }
  | {
      kind: "sphere-lat-long";
      label: string;
      latitude: number;
      longitude: number;
    }
  | {
      kind: "surface-position";
      label: string;
      position: [number, number, number];
    };

type AgentScenarioInput = {
  scenario?: AgentScenarioName;
  warmupFrames?: number;
  measureFrames?: number;
  readback?: boolean;
  timeoutMs?: number;
  computeBudgetMs?: number;
  overrides?: AgentScenarioOverrides;
};

type AgentScenarioOverrides = {
  maxNodes?: number;
  innerTileSegments?: number;
  distanceFactor?: number;
};

type AgentAssertion = {
  name: string;
  pass: boolean;
  detail?: string;
};

type AgentTaskTiming = {
  taskId: string;
  taskName: string;
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
};

type AgentCacheHit = {
  taskId: string;
  taskName: string;
  count: number;
};

type AgentTerrainSample = {
  label: string;
  kind: ScenarioSamplePoint["kind"];
  input: Record<string, number | [number, number, number]>;
  valid: boolean;
  elevation: number | null;
  normal: [number, number, number] | null;
  position: [number, number, number] | null;
  direction: [number, number, number] | null;
  error?: string;
};

type AgentTerrainLevelStats = {
  min: number | null;
  max: number | null;
  leavesAtMaxLevel: number;
  counts: Record<string, number>;
};

type AgentNumberStats = {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
};

type AgentIncrementalTelemetry = {
  candidateCount: number;
  visibleCount: number;
  guardCount: number;
  frustumCulledCount: number;
  horizonCulledCount: number;
  unculledCount: number;
  visibleRatio: number;
  visibleSlotCount: number;
  activeSlotCount?: number;
  dirtyVisibleCount: number;
  reusedCount: number;
  allocatedCount: number;
  evictedCount: number;
  retainedInactiveCount: number;
  overflowCount: number;
  dirtyVisibleRatio: number;
  reuseRatio: number;
};

type AgentIncrementalSummary = {
  candidateCount: AgentNumberStats;
  visibleCount: AgentNumberStats;
  activeSlotCount: AgentNumberStats;
  horizonCulledCount: AgentNumberStats;
  dirtyVisibleCount: AgentNumberStats;
  visibleRatio: AgentNumberStats;
  dirtyVisibleRatio: AgentNumberStats;
  reuseRatio: AgentNumberStats;
};

type AgentFrameSample = {
  frame: number;
  measured: boolean;
  phase: "warmup" | "measure";
  cameraPathKind: ScenarioCameraPathKind;
  pathProgress: number | null;
  altitudeMeters: number | null;
  cameraOrigin: [number, number, number];
  wallMs: number;
  leafCount: number;
  maxLeafLevel: number | null;
  leavesAtMaxLevel: number;
  incremental: AgentIncrementalTelemetry;
  gpu: AgentGpuTimingSample | null;
};

type AgentFrameSummary = {
  wallMs: AgentNumberStats;
  leafCount: AgentNumberStats;
  maxLeafLevel: AgentNumberStats;
  incremental: AgentIncrementalSummary;
  gpuComputeMs: AgentNumberStats;
  gpuTotalMs: AgentNumberStats;
};

type AgentGpuReadback = {
  supported: boolean;
  elevationFieldHash: string | null;
  tileBoundsHash: string | null;
  elevationNanCount: number | null;
  tileBoundsNanCount: number | null;
  elevationElementCount: number;
  tileBoundsElementCount: number;
  error?: string;
};

type AgentGpuInfo = {
  webgpuAvailable: boolean;
  adapterName?: string;
  adapterFeatures: string[];
  deviceFeatures: string[];
  computeLimits: ReturnType<typeof getDeviceComputeLimits> | null;
  timestampQueryEnabled: boolean;
  timestampDiagnostics: AgentGpuTimestampDiagnostics;
};

type AgentTimestampPoolSnapshot = {
  exists: boolean;
  trackTimestamp: boolean | null;
  currentQueryIndex: number | null;
  lastValueMs: number | null;
  resolvedTimestampCount: number | null;
  frames: number[];
  pendingResolve: boolean;
};

type AgentGpuTimestampDiagnostics = {
  hasResolver: boolean;
  rendererTrackTimestamp: boolean | null;
  backendTrackTimestamp: boolean | null;
  renderPool: AgentTimestampPoolSnapshot;
  computePool: AgentTimestampPoolSnapshot;
};

type AgentGpuTimingSample = {
  renderMs: number | null;
  computeMs: number | null;
  totalMs: number | null;
  renderQueryCount: number;
  computeQueryCount: number;
  renderFrames: number[];
  computeFrames: number[];
  computePasses: AgentGpuComputePassTiming[];
};

type AgentGpuComputePassTiming = {
  uid: string | null;
  name: string;
  dispatchSize: number | [number, number, number] | string | null;
  durationMs: number | null;
};

type RendererGpuProfiler = {
  enable(): boolean;
  sample(): Promise<AgentGpuTimingSample | null>;
};

type TimestampCapableRenderer = {
  trackTimestamp?: boolean;
  backend?: {
    trackTimestamp?: boolean;
    timestampQueryPool?: Partial<Record<"render" | "compute", TimestampQueryPoolLike | null>>;
  };
  resolveTimestampsAsync?: (type: "render" | "compute") => Promise<number | undefined>;
};

type TimestampQueryPoolLike = {
  trackTimestamp?: boolean;
  currentQueryIndex?: number;
  lastValue?: number;
  frames?: unknown;
  pendingResolve?: unknown;
  timestamps?: { size?: unknown };
};

type TimestampQueryPoolWithValues = TimestampQueryPoolLike & {
  timestamps?: Map<string, number>;
};

type ComputeTraceRenderer = WebGPURenderer & {
  compute: (computeNodes: unknown, dispatchSize?: unknown) => unknown;
  backend?: TimestampCapableRenderer["backend"] & {
    getTimestampUID?: (computeNodes: unknown) => string;
  };
};

type PendingComputePass = Omit<AgentGpuComputePassTiming, "durationMs">;

export type AgentScenarioResult = {
  ok: boolean;
  scenario: AgentScenarioName;
  startedAt: string;
  finishedAt: string;
  warmupFrames: number;
  measureFrames: number;
  computeBudgetMs: number | null;
  gpu: AgentGpuInfo;
  graphReports: RunReport[];
  taskTimings: AgentTaskTiming[];
  cacheHits: AgentCacheHit[];
  taskErrors: { taskId: string; message: string }[];
  frames: {
    samples: AgentFrameSample[];
    summary: AgentFrameSummary;
  };
  terrain: {
    surfaceKind: ScenarioSurfaceKind;
    topologyKind: string;
    radius: number;
    leafCount: number;
    leafCapacity: number;
    maxLevel: number;
    levelStats: AgentTerrainLevelStats;
    innerTileSegments: number;
    incremental: AgentIncrementalTelemetry;
    elevationRange: { min: number; max: number } | null;
    queryGeneration: number;
    samples: AgentTerrainSample[];
  };
  readback: AgentGpuReadback;
  gpuTimings: {
    supported: boolean;
    samples: AgentGpuTimingSample[];
  };
  assertions: AgentAssertion[];
};

type AgentApi = {
  ready: boolean;
  runScenario(input?: AgentScenarioInput): Promise<AgentScenarioResult>;
};

declare global {
  interface Window {
    __helloTerrainAgent?: AgentApi;
  }
}

type ScenarioDefinition = {
  name: AgentScenarioName;
  surfaceKind: ScenarioSurfaceKind;
  cameraPath?: ScenarioCameraPath;
  defaultWarmupFrames?: number;
  defaultMeasureFrames?: number;
  topology: Topology | null;
  rootSize: number;
  radius: number;
  maxLevel: number;
  maxNodes: number;
  innerTileSegments: number;
  skirtScale: number;
  elevationScale: number;
  distanceFactor: number;
  cameraOrigin: { x: number; y: number; z: number };
  elevation: ElevationCallback;
  samplePoints: ScenarioSamplePoint[];
};

type ScenarioCameraPath = {
  kind: "orbit-surface";
  preset: OrbitSurfacePreset;
  startAltitudeMeters: number;
  endAltitudeMeters: number;
  sweepDegrees: number;
};

type ScenarioCameraFrame = {
  cameraOrigin: { x: number; y: number; z: number };
  cameraPathKind: ScenarioCameraPathKind;
  pathProgress: number | null;
  altitudeMeters: number | null;
  phase: "warmup" | "measure";
};

const DEFAULT_WARMUP_FRAMES = 4;
const DEFAULT_MEASURE_FRAMES = 8;
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_RADIUS = 1000;
const EARTH_RADIUS_METERS = 6_371_000;
const TORUS_MAJOR_RADIUS_METERS = EARTH_RADIUS_METERS * 0.72;
const TORUS_MINOR_RADIUS_METERS = EARTH_RADIUS_METERS - TORUS_MAJOR_RADIUS_METERS;
const ORBIT_SURFACE_START_ALTITUDE_METERS = 2_000_000;
const ORBIT_SURFACE_END_ALTITUDE_METERS = 200;
const ORBIT_SURFACE_SWEEP_DEGREES = 6;
const ORBIT_SURFACE_WARMUP_FRAMES = 8;
const ORBIT_SURFACE_MEASURE_FRAMES = 64;

const zeroElevation: ElevationCallback = () => float(0);

const sineElevation: ElevationCallback = ({ worldPosition }) => {
  const waveX = sin(worldPosition.x.mul(float(0.045)));
  const waveZ = cos(worldPosition.z.mul(float(0.037)));
  return waveX.mul(waveZ).mul(float(2.5));
};

const earthSphereElevation: ElevationCallback = ({ worldPosition }) => {
  const dir = worldPosition.normalize();
  const bands = sin(dir.y.mul(float(18)));
  const continents = cos(dir.x.mul(float(24)).add(dir.z.mul(float(11))));
  return bands.mul(continents).mul(float(0.5)).add(float(0.5));
};

const earthTorusElevation: ElevationCallback = ({ worldPosition }) => {
  const p = worldPosition.mul(float(1 / EARTH_RADIUS_METERS));
  const aroundMajor = sin(p.x.mul(float(22)).add(p.z.mul(float(17))));
  const aroundTube = cos(p.y.mul(float(29)).add(p.z.mul(float(7))));
  return aroundMajor.mul(aroundTube).mul(float(0.5)).add(float(0.5));
};

function orbitSurfaceStartDirection(preset: OrbitSurfacePreset) {
  if (preset === "edge") return new THREE.Vector3(1, 1, 0.24).normalize();
  if (preset === "corner") return new THREE.Vector3(1, 1, 1).normalize();
  return new THREE.Vector3(0.22, 0.41, 1).normalize();
}

function smooth01(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function interpolateAltitude(
  startAltitudeMeters: number,
  endAltitudeMeters: number,
  progress: number,
) {
  const start = Math.max(startAltitudeMeters, 0.01);
  const end = Math.max(endAltitudeMeters, 0.01);
  const t = smooth01(progress);
  return Math.exp(Math.log(start) + (Math.log(end) - Math.log(start)) * t);
}

function resolveOrbitSurfaceScenarioName(
  name: AgentScenarioName,
): OrbitSurfacePreset | null {
  if (name === "earth-sphere-orbit-surface-edge") return "edge";
  if (name === "earth-sphere-orbit-surface-corner") return "corner";
  if (name === "earth-sphere-orbit-surface-center") return "center";
  return null;
}

function createOrbitSurfaceScenario(
  name: AgentScenarioName,
  preset: OrbitSurfacePreset,
): ScenarioDefinition {
  return {
    name,
    surfaceKind: "sphere",
    cameraPath: {
      kind: "orbit-surface",
      preset,
      startAltitudeMeters: ORBIT_SURFACE_START_ALTITUDE_METERS,
      endAltitudeMeters: ORBIT_SURFACE_END_ALTITUDE_METERS,
      sweepDegrees: ORBIT_SURFACE_SWEEP_DEGREES,
    },
    defaultWarmupFrames: ORBIT_SURFACE_WARMUP_FRAMES,
    defaultMeasureFrames: ORBIT_SURFACE_MEASURE_FRAMES,
    topology: createCubeSphereTopology({ radius: EARTH_RADIUS_METERS }),
    rootSize: EARTH_RADIUS_METERS,
    radius: EARTH_RADIUS_METERS,
    maxLevel: 18,
    maxNodes: 16384,
    innerTileSegments: 17,
    skirtScale: 250,
    elevationScale: 4200,
    distanceFactor: 16,
    cameraOrigin: { x: 0, y: 0, z: EARTH_RADIUS_METERS + ORBIT_SURFACE_START_ALTITUDE_METERS },
    elevation: earthSphereElevation,
    samplePoints: [
      { kind: "sphere-lat-long", label: "equator-prime", latitude: 0, longitude: 0 },
      { kind: "sphere-lat-long", label: "north-mid", latitude: 37, longitude: -122 },
      { kind: "sphere-lat-long", label: "south-mid", latitude: -34, longitude: 151 },
      { kind: "sphere-lat-long", label: "near-pole", latitude: 78, longitude: 35 },
    ],
  };
}

function resolveScenario(name: AgentScenarioName): ScenarioDefinition {
  const orbitSurfacePreset = resolveOrbitSurfaceScenarioName(name);
  if (orbitSurfacePreset) {
    return createOrbitSurfaceScenario(name, orbitSurfacePreset);
  }

  if (name === "flat-zero-smoke") {
    return {
      name,
      surfaceKind: "flat",
      topology: null,
      rootSize: 128,
      radius: DEFAULT_RADIUS,
      maxLevel: 8,
      maxNodes: 256,
      innerTileSegments: 13,
      skirtScale: 8,
      elevationScale: 1,
      distanceFactor: 1.4,
      cameraOrigin: { x: 0, y: 28, z: 0 },
      elevation: zeroElevation,
      samplePoints: [
        { kind: "flat", label: "origin", x: 0, z: 0 },
        { kind: "flat", label: "northeast", x: 16, z: 16 },
        { kind: "flat", label: "west-ridge", x: -24, z: 12 },
      ],
    };
  }

  if (name === "earth-sphere-load" || name === "earth-sphere-surface-load") {
    const surfaceLoad = name === "earth-sphere-surface-load";
    const cameraRadius = surfaceLoad ? EARTH_RADIUS_METERS : EARTH_RADIUS_METERS * 1.001;
    return {
      name,
      surfaceKind: "sphere",
      topology: createCubeSphereTopology({ radius: EARTH_RADIUS_METERS }),
      rootSize: EARTH_RADIUS_METERS,
      radius: EARTH_RADIUS_METERS,
      maxLevel: 18,
      maxNodes: surfaceLoad ? 16384 : 4096,
      innerTileSegments: 17,
      skirtScale: 250,
      elevationScale: 4200,
      distanceFactor: surfaceLoad ? 16 : 8,
      cameraOrigin: { x: 0, y: 0, z: cameraRadius },
      elevation: earthSphereElevation,
      samplePoints: [
        { kind: "sphere-lat-long", label: "equator-prime", latitude: 0, longitude: 0 },
        { kind: "sphere-lat-long", label: "north-mid", latitude: 37, longitude: -122 },
        { kind: "sphere-lat-long", label: "south-mid", latitude: -34, longitude: 151 },
        { kind: "sphere-lat-long", label: "near-pole", latitude: 78, longitude: 35 },
      ],
    };
  }

  if (name === "earth-torus-load" || name === "earth-torus-surface-load") {
    const outerRadius = TORUS_MAJOR_RADIUS_METERS + TORUS_MINOR_RADIUS_METERS;
    const surfaceLoad = name === "earth-torus-surface-load";
    const cameraRadius = surfaceLoad ? outerRadius : outerRadius * 1.001;
    return {
      name,
      surfaceKind: "torus",
      topology: createTorusTopology({
        majorRadius: TORUS_MAJOR_RADIUS_METERS,
        minorRadius: TORUS_MINOR_RADIUS_METERS,
      }),
      rootSize: outerRadius,
      radius: outerRadius,
      maxLevel: 18,
      maxNodes: surfaceLoad ? 16384 : 4096,
      innerTileSegments: 17,
      skirtScale: 250,
      elevationScale: 4200,
      distanceFactor: surfaceLoad ? 16 : 8,
      cameraOrigin: { x: 0, y: 0, z: cameraRadius },
      elevation: earthTorusElevation,
      samplePoints: [
        {
          kind: "surface-position",
          label: "outer-prime",
          position: [0, 0, outerRadius + TORUS_MINOR_RADIUS_METERS],
        },
        {
          kind: "surface-position",
          label: "outer-east",
          position: [outerRadius + TORUS_MINOR_RADIUS_METERS, 0, 0],
        },
        {
          kind: "surface-position",
          label: "upper-tube",
          position: [TORUS_MAJOR_RADIUS_METERS, TORUS_MINOR_RADIUS_METERS * 2, 0],
        },
        {
          kind: "surface-position",
          label: "inner-west",
          position: [0, 0, -TORUS_MAJOR_RADIUS_METERS],
        },
      ],
    };
  }

  return {
    name: "flat-sine-smoke",
    surfaceKind: "flat",
    topology: null,
    rootSize: 192,
    radius: DEFAULT_RADIUS,
    maxLevel: 10,
    maxNodes: 512,
    innerTileSegments: 17,
    skirtScale: 10,
    elevationScale: 3,
    distanceFactor: 1.35,
    cameraOrigin: { x: 18, y: 34, z: 26 },
    elevation: sineElevation,
    samplePoints: [
      { kind: "flat", label: "origin", x: 0, z: 0 },
      { kind: "flat", label: "northeast", x: 24, z: 24 },
      { kind: "flat", label: "west-ridge", x: -36, z: 18 },
      { kind: "flat", label: "southeast", x: 48, z: -32 },
    ],
  };
}

function positiveIntegerOverride(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function positiveNumberOverride(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function applyScenarioOverrides(
  scenario: ScenarioDefinition,
  overrides: AgentScenarioOverrides | undefined,
): ScenarioDefinition {
  if (!overrides) return scenario;

  return {
    ...scenario,
    maxNodes: positiveIntegerOverride(overrides.maxNodes) ?? scenario.maxNodes,
    innerTileSegments:
      positiveIntegerOverride(overrides.innerTileSegments) ?? scenario.innerTileSegments,
    distanceFactor: positiveNumberOverride(overrides.distanceFactor) ?? scenario.distanceFactor,
  };
}

function graphTargets() {
  return [
    terrainTasks.visibleLeafSet,
    terrainTasks.tileSlotUpdate,
    terrainTasks.gpuSpatialIndexUpload,
    terrainTasks.terrainReadback,
  ] as const;
}

function cloneIncrementalTelemetry(
  telemetry: AgentIncrementalTelemetry,
): AgentIncrementalTelemetry {
  return {
    candidateCount: telemetry.candidateCount,
    visibleCount: telemetry.visibleCount,
    guardCount: telemetry.guardCount,
    frustumCulledCount: telemetry.frustumCulledCount,
    horizonCulledCount: telemetry.horizonCulledCount,
    unculledCount: telemetry.unculledCount,
    visibleRatio: telemetry.visibleRatio,
    visibleSlotCount: telemetry.visibleSlotCount,
    activeSlotCount: telemetry.activeSlotCount ?? telemetry.visibleSlotCount,
    dirtyVisibleCount: telemetry.dirtyVisibleCount,
    reusedCount: telemetry.reusedCount,
    allocatedCount: telemetry.allocatedCount,
    evictedCount: telemetry.evictedCount,
    retainedInactiveCount: telemetry.retainedInactiveCount,
    overflowCount: telemetry.overflowCount,
    dirtyVisibleRatio: telemetry.dirtyVisibleRatio,
    reuseRatio: telemetry.reuseRatio,
  };
}

function orbitSurfaceCameraFrame(
  scenario: ScenarioDefinition,
  frame: number,
  warmupFrames: number,
  measureFrames: number,
): ScenarioCameraFrame | null {
  const cameraPath = scenario.cameraPath;
  if (!cameraPath || cameraPath.kind !== "orbit-surface") return null;

  const measuredFrame = Math.max(0, frame - warmupFrames);
  const progress =
    frame < warmupFrames ? 0 : Math.min(1, measuredFrame / Math.max(1, measureFrames - 1));
  const altitudeMeters = interpolateAltitude(
    cameraPath.startAltitudeMeters,
    cameraPath.endAltitudeMeters,
    progress,
  );
  const direction = orbitSurfaceStartDirection(cameraPath.preset);
  const sweepAxis = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
  if (sweepAxis.lengthSq() < 1e-8) sweepAxis.set(0, 0, 1);
  direction.applyAxisAngle(
    sweepAxis.normalize(),
    THREE.MathUtils.degToRad(cameraPath.sweepDegrees * progress),
  );
  const cameraRadius = scenario.radius + altitudeMeters;

  return {
    cameraOrigin: {
      x: direction.x * cameraRadius,
      y: direction.y * cameraRadius,
      z: direction.z * cameraRadius,
    },
    cameraPathKind: cameraPath.kind,
    pathProgress: progress,
    altitudeMeters,
    phase: frame < warmupFrames ? "warmup" : "measure",
  };
}

function scenarioCameraFrame(
  scenario: ScenarioDefinition,
  frame: number,
  warmupFrames: number,
  measureFrames: number,
): ScenarioCameraFrame {
  const orbitSurfaceFrame = orbitSurfaceCameraFrame(
    scenario,
    frame,
    warmupFrames,
    measureFrames,
  );
  if (orbitSurfaceFrame) return orbitSurfaceFrame;

  return {
    cameraOrigin: {
      x: scenario.cameraOrigin.x + frame * 0.001,
      y: scenario.cameraOrigin.y,
      z: scenario.cameraOrigin.z,
    },
    cameraPathKind: "static",
    pathProgress: null,
    altitudeMeters: null,
    phase: frame < warmupFrames ? "warmup" : "measure",
  };
}

function setScenarioParams(
  graph: TerrainGraph,
  scenario: ScenarioDefinition,
  cameraFrame: ScenarioCameraFrame,
) {
  graph
    .set(topology, scenario.topology)
    .set(origin, { x: 0, y: 0, z: 0 })
    .set(rootSize, scenario.rootSize)
    .set(radius, scenario.radius)
    .set(maxLevel, scenario.maxLevel)
    .set(maxNodes, scenario.maxNodes)
    .set(innerTileSegments, scenario.innerTileSegments)
    .set(skirtScale, scenario.skirtScale)
    .set(elevationScale, scenario.elevationScale)
    .set(terrainFieldFilter, "nearest")
    .set(elevationFn as never, (() => scenario.elevation) as never)
    .set(cameraView, {
      cameraOrigin: {
        x: cameraFrame.cameraOrigin.x,
        y: cameraFrame.cameraOrigin.y,
        z: cameraFrame.cameraOrigin.z,
      },
      viewProjectionMatrix: Array.from({ length: 16 }, () => 0),
    })
    .set(lodCriteria, {
      mode: "distance",
      distanceFactor: scenario.distanceFactor,
    });
}

function tupleFromVector3(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function invalidTerrainSample(
  point: ScenarioSamplePoint,
  error: string,
): AgentTerrainSample {
  return {
    label: point.label,
    kind: point.kind,
    input: sampleInput(point),
    valid: false,
    elevation: null,
    normal: null,
    position: null,
    direction: null,
    error,
  };
}

function sampleInput(point: ScenarioSamplePoint): Record<string, number | [number, number, number]> {
  if (point.kind === "flat") return { x: point.x, z: point.z };
  if (point.kind === "sphere-lat-long") {
    return { latitude: point.latitude, longitude: point.longitude };
  }
  return { position: point.position };
}

function terrainSurfaceSampleToAgentSample(
  point: ScenarioSamplePoint,
  sample: {
    valid: boolean;
    elevation: number;
    normal: THREE.Vector3;
    position: THREE.Vector3;
    direction: THREE.Vector3;
  },
): AgentTerrainSample {
  return {
    label: point.label,
    kind: point.kind,
    input: sampleInput(point),
    valid: sample.valid,
    elevation: sample.valid ? sample.elevation : null,
    normal: sample.valid ? tupleFromVector3(sample.normal) : null,
    position: sample.valid ? tupleFromVector3(sample.position) : null,
    direction: sample.valid ? tupleFromVector3(sample.direction) : null,
  };
}

function sampleTerrainPoint(
  queryContext: TerrainQueryContext,
  point: ScenarioSamplePoint,
): AgentTerrainSample {
  if (point.kind === "flat") {
    const sample = queryContext.query.sampleTerrain(point.x, point.z);
    return {
      label: point.label,
      kind: point.kind,
      input: sampleInput(point),
      valid: sample.valid,
      elevation: sample.valid ? sample.elevation : null,
      normal: sample.valid ? tupleFromVector3(sample.normal) : null,
      position: sample.valid ? [point.x, sample.elevation, point.z] : null,
      direction: null,
    };
  }

  if (point.kind === "sphere-lat-long") {
    const query = queryContext.sphereQuery;
    if (!query) return invalidTerrainSample(point, "sphereQuery is unavailable");
    return terrainSurfaceSampleToAgentSample(
      point,
      query.sampleTerrainByLatLong(point.latitude, point.longitude),
    );
  }

  const query = queryContext.surfaceQuery;
  if (!query) return invalidTerrainSample(point, "surfaceQuery is unavailable");
  return terrainSurfaceSampleToAgentSample(
    point,
    query.sampleTerrainByPosition(new THREE.Vector3(...point.position)),
  );
}

function summarizeLeafLevels(
  leafSet: { count: number; level: ArrayLike<number> },
  targetMaxLevel: number,
): AgentTerrainLevelStats {
  if (leafSet.count <= 0) {
    return { min: null, max: null, leavesAtMaxLevel: 0, counts: {} };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let leavesAtMaxLevel = 0;
  const counts: Record<string, number> = {};

  for (let i = 0; i < leafSet.count; i += 1) {
    const level = leafSet.level[i] ?? 0;
    if (level < min) min = level;
    if (level > max) max = level;
    if (level === targetMaxLevel) leavesAtMaxLevel += 1;
    const key = String(level);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return { min, max, leavesAtMaxLevel, counts };
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1),
  );
  return sortedValues[index] ?? null;
}

function summarizeNumbers(values: Array<number | null | undefined>): AgentNumberStats {
  const finiteValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (finiteValues.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p50: null, p95: null, p99: null };
  }

  const sortedValues = [...finiteValues].sort((a, b) => a - b);
  const total = finiteValues.reduce((sum, value) => sum + value, 0);
  return {
    count: finiteValues.length,
    min: sortedValues[0] ?? null,
    max: sortedValues[sortedValues.length - 1] ?? null,
    mean: total / finiteValues.length,
    p50: percentile(sortedValues, 50),
    p95: percentile(sortedValues, 95),
    p99: percentile(sortedValues, 99),
  };
}

function summarizeFrames(frames: AgentFrameSample[]): AgentFrameSummary {
  const measuredFrames = frames.filter((frame) => frame.measured);
  return {
    wallMs: summarizeNumbers(measuredFrames.map((frame) => frame.wallMs)),
    leafCount: summarizeNumbers(measuredFrames.map((frame) => frame.leafCount)),
    maxLeafLevel: summarizeNumbers(measuredFrames.map((frame) => frame.maxLeafLevel)),
    incremental: {
      candidateCount: summarizeNumbers(
        measuredFrames.map((frame) => frame.incremental.candidateCount),
      ),
      visibleCount: summarizeNumbers(
        measuredFrames.map((frame) => frame.incremental.visibleCount),
      ),
      activeSlotCount: summarizeNumbers(
        measuredFrames.map((frame) => frame.incremental.activeSlotCount),
      ),
      horizonCulledCount: summarizeNumbers(
        measuredFrames.map((frame) => frame.incremental.horizonCulledCount),
      ),
      dirtyVisibleCount: summarizeNumbers(
        measuredFrames.map((frame) => frame.incremental.dirtyVisibleCount),
      ),
      visibleRatio: summarizeNumbers(
        measuredFrames.map((frame) => frame.incremental.visibleRatio),
      ),
      dirtyVisibleRatio: summarizeNumbers(
        measuredFrames.map((frame) => frame.incremental.dirtyVisibleRatio),
      ),
      reuseRatio: summarizeNumbers(
        measuredFrames.map((frame) => frame.incremental.reuseRatio),
      ),
    },
    gpuComputeMs: summarizeNumbers(measuredFrames.map((frame) => frame.gpu?.computeMs)),
    gpuTotalMs: summarizeNumbers(measuredFrames.map((frame) => frame.gpu?.totalMs)),
  };
}

function boolOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getTimestampCapableRenderer(renderer: WebGPURenderer) {
  return renderer as unknown as TimestampCapableRenderer;
}

function getTimestampPoolSnapshot(
  renderer: WebGPURenderer,
  type: "render" | "compute",
): AgentTimestampPoolSnapshot {
  const pool = getTimestampCapableRenderer(renderer).backend?.timestampQueryPool?.[type];

  if (!pool) {
    return {
      exists: false,
      trackTimestamp: null,
      currentQueryIndex: null,
      lastValueMs: null,
      resolvedTimestampCount: null,
      frames: [],
      pendingResolve: false,
    };
  }

  return {
    exists: true,
    trackTimestamp: boolOrNull(pool.trackTimestamp),
    currentQueryIndex: numberOrNull(pool.currentQueryIndex),
    lastValueMs: numberOrNull(pool.lastValue),
    resolvedTimestampCount: numberOrNull(pool.timestamps?.size),
    frames: Array.isArray(pool.frames)
      ? pool.frames.filter((frame): frame is number => typeof frame === "number")
      : [],
    pendingResolve: Boolean(pool.pendingResolve),
  };
}

function getTimestampDiagnostics(renderer: WebGPURenderer): AgentGpuTimestampDiagnostics {
  const gpu = getTimestampCapableRenderer(renderer);
  return {
    hasResolver: typeof gpu.resolveTimestampsAsync === "function",
    rendererTrackTimestamp: boolOrNull(gpu.trackTimestamp),
    backendTrackTimestamp: boolOrNull(gpu.backend?.trackTimestamp),
    renderPool: getTimestampPoolSnapshot(renderer, "render"),
    computePool: getTimestampPoolSnapshot(renderer, "compute"),
  };
}

function freshQueryCount(snapshot: AgentTimestampPoolSnapshot) {
  return snapshot.currentQueryIndex ?? 0;
}

function timestampFromFreshQueries(raw: number | undefined, queryCount: number) {
  return queryCount > 0 && typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function computeNodeName(computeNodes: unknown) {
  const list = Array.isArray(computeNodes) ? computeNodes : [computeNodes];
  const names = list.map((node, index) => {
    const maybeNode = node as { name?: unknown; id?: unknown };
    if (typeof maybeNode.name === "string" && maybeNode.name.length > 0) {
      return maybeNode.name;
    }
    if (typeof maybeNode.id === "number") return `compute#${maybeNode.id}`;
    return `compute[${index}]`;
  });
  return names.join("+");
}

function computeDispatchSize(dispatchSize: unknown): AgentGpuComputePassTiming["dispatchSize"] {
  if (typeof dispatchSize === "number") return dispatchSize;
  if (
    Array.isArray(dispatchSize) &&
    dispatchSize.length === 3 &&
    dispatchSize.every((value) => typeof value === "number")
  ) {
    return dispatchSize as [number, number, number];
  }
  if (dispatchSize == null) return null;
  return "indirect";
}

function traceRendererCompute(renderer: WebGPURenderer, passes: PendingComputePass[]) {
  const traced = renderer as ComputeTraceRenderer;
  const originalCompute = traced.compute.bind(renderer);

  traced.compute = ((computeNodes: unknown, dispatchSize?: unknown) => {
    const result = originalCompute(computeNodes, dispatchSize);
    const uid = traced.backend?.getTimestampUID?.(computeNodes);
    passes.push({
      uid: typeof uid === "string" ? uid : null,
      name: computeNodeName(computeNodes),
      dispatchSize: computeDispatchSize(dispatchSize),
    });
    return result;
  }) as ComputeTraceRenderer["compute"];

  return () => {
    traced.compute = originalCompute;
  };
}

function resolveComputePassTimings(
  renderer: WebGPURenderer,
  passes: PendingComputePass[],
): AgentGpuComputePassTiming[] {
  const pool = getTimestampCapableRenderer(renderer).backend?.timestampQueryPool
    ?.compute as TimestampQueryPoolWithValues | null | undefined;
  const timestamps = pool?.timestamps;
  return passes.map((pass) => ({
    ...pass,
    durationMs: pass.uid ? numberOrNull(timestamps?.get(pass.uid)) : null,
  }));
}

function createRendererGpuProfiler(renderer: WebGPURenderer): RendererGpuProfiler {
  const gpu = getTimestampCapableRenderer(renderer);

  return {
    enable() {
      const diagnostics = getTimestampDiagnostics(renderer);
      return diagnostics.hasResolver && diagnostics.backendTrackTimestamp === true;
    },
    async sample() {
      const diagnostics = getTimestampDiagnostics(renderer);
      if (!diagnostics.hasResolver || diagnostics.backendTrackTimestamp !== true) {
        return null;
      }

      const renderBefore = getTimestampPoolSnapshot(renderer, "render");
      const computeBefore = getTimestampPoolSnapshot(renderer, "compute");
      const renderQueryCount = freshQueryCount(renderBefore);
      const computeQueryCount = freshQueryCount(computeBefore);
      const rawRenderMs =
        renderQueryCount > 0 ? await gpu.resolveTimestampsAsync?.("render") : undefined;
      const rawComputeMs =
        computeQueryCount > 0 ? await gpu.resolveTimestampsAsync?.("compute") : undefined;
      const renderAfter = getTimestampPoolSnapshot(renderer, "render");
      const computeAfter = getTimestampPoolSnapshot(renderer, "compute");
      const renderMs = timestampFromFreshQueries(rawRenderMs, renderQueryCount);
      const computeMs = timestampFromFreshQueries(rawComputeMs, computeQueryCount);
      const totalMs =
        renderMs === null && computeMs === null ? null : (renderMs ?? 0) + (computeMs ?? 0);

      return {
        renderMs,
        computeMs,
        totalMs,
        renderQueryCount,
        computeQueryCount,
        renderFrames: renderAfter.frames,
        computeFrames: computeAfter.frames,
        computePasses: [],
      };
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForQueryGeneration(
  graph: TerrainGraph,
  previousGeneration: number,
  timeoutMs: number,
) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const queryContext = graph.peek(terrainTasks.terrainQuery);
    if (queryContext?.cache.ready && queryContext.cache.generation > previousGeneration) {
      return true;
    }
    await sleep(16);
  }
  return false;
}

function eventMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function taskNameById(graph: TerrainGraph) {
  const names = new Map<string, string>();
  for (const node of graph.inspect({ includeRuntime: true }).nodes) {
    if (node.kind === "task") names.set(node.id, node.name ?? node.id);
  }
  return names;
}

function summarizeTaskTimings(
  events: GraphEvent[],
  names: Map<string, string>,
): {
  taskTimings: AgentTaskTiming[];
  cacheHits: AgentCacheHit[];
  taskErrors: { taskId: string; message: string }[];
} {
  const byTask = new Map<string, number[]>();
  const cacheHitsByTask = new Map<string, number>();
  const taskErrors: { taskId: string; message: string }[] = [];

  for (const event of events) {
    if (event.type === "task:finish") {
      const durations = byTask.get(event.taskId) ?? [];
      durations.push(event.durationMs);
      byTask.set(event.taskId, durations);
    } else if (event.type === "task:cacheHit") {
      cacheHitsByTask.set(event.taskId, (cacheHitsByTask.get(event.taskId) ?? 0) + 1);
    } else if (event.type === "task:error") {
      taskErrors.push({ taskId: event.taskId, message: eventMessage(event.error) });
    }
  }

  const taskTimings = [...byTask.entries()]
    .map(([taskId, durations]) => {
      const totalMs = durations.reduce((sum, value) => sum + value, 0);
      return {
        taskId,
        taskName: names.get(taskId) ?? taskId,
        count: durations.length,
        totalMs,
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
        meanMs: totalMs / durations.length,
      };
    })
    .sort((a, b) => b.totalMs - a.totalMs);
  const cacheHits = [...cacheHitsByTask.entries()]
    .map(([taskId, count]) => ({
      taskId,
      taskName: names.get(taskId) ?? taskId,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return { taskTimings, cacheHits, taskErrors };
}

function toHex32(value: number) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function hashFloat32(data: Float32Array, elementCount: number) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, elementCount * 4);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return toHex32(hash);
}

function countNaN(data: Float32Array, elementCount: number) {
  let count = 0;
  for (let i = 0; i < elementCount; i += 1) {
    if (Number.isNaN(data[i])) count += 1;
  }
  return count;
}

async function readFloat32Attribute(
  renderer: WebGPURenderer,
  attribute: StorageBufferAttribute,
  elementCount: number,
) {
  const maybeReadback = renderer as WebGPURenderer & {
    getArrayBufferAsync?: (attribute: StorageBufferAttribute) => Promise<ArrayBuffer>;
  };
  if (!maybeReadback.getArrayBufferAsync) return null;
  const buffer = await maybeReadback.getArrayBufferAsync(attribute);
  const availableElements = Math.floor(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  return new Float32Array(buffer, 0, Math.min(elementCount, availableElements));
}

async function collectReadback(
  renderer: WebGPURenderer,
  graph: TerrainGraph,
  activeSlotCount: number,
  edgeVertexCount: number,
  enabled: boolean,
): Promise<AgentGpuReadback> {
  const elevationElementCount = activeSlotCount * edgeVertexCount * edgeVertexCount;
  const tileBoundsElementCount = activeSlotCount * 2;

  if (!enabled) {
    return {
      supported: false,
      elevationFieldHash: null,
      tileBoundsHash: null,
      elevationNanCount: null,
      tileBoundsNanCount: null,
      elevationElementCount,
      tileBoundsElementCount,
    };
  }

  try {
    const elevationContext = graph.get(terrainTasks.createElevationFieldContext);
    const boundsContext = graph.get(terrainTasks.tileBoundsReduction);
    const elevationData = await readFloat32Attribute(
      renderer,
      elevationContext.attribute,
      elevationElementCount,
    );
    const boundsData = await readFloat32Attribute(
      renderer,
      boundsContext.attribute,
      tileBoundsElementCount,
    );

    if (!elevationData || !boundsData) {
      return {
        supported: false,
        elevationFieldHash: null,
        tileBoundsHash: null,
        elevationNanCount: null,
        tileBoundsNanCount: null,
        elevationElementCount,
        tileBoundsElementCount,
        error: "renderer.getArrayBufferAsync is unavailable",
      };
    }

    return {
      supported: true,
      elevationFieldHash: hashFloat32(elevationData, elevationData.length),
      tileBoundsHash: hashFloat32(boundsData, boundsData.length),
      elevationNanCount: countNaN(elevationData, elevationData.length),
      tileBoundsNanCount: countNaN(boundsData, boundsData.length),
      elevationElementCount,
      tileBoundsElementCount,
    };
  } catch (error) {
    return {
      supported: false,
      elevationFieldHash: null,
      tileBoundsHash: null,
      elevationNanCount: null,
      tileBoundsNanCount: null,
      elevationElementCount,
      tileBoundsElementCount,
      error: eventMessage(error),
    };
  }
}

function createAssertions(result: Omit<AgentScenarioResult, "ok" | "assertions">) {
  const validSampleCount = result.terrain.samples.filter((sample) => sample.valid).length;
  const sampleCullingActive =
    result.terrain.incremental.frustumCulledCount > 0 ||
    result.terrain.incremental.horizonCulledCount > 0;
  const samplesValid = sampleCullingActive
    ? validSampleCount > 0
    : validSampleCount === result.terrain.samples.length;
  const assertions: AgentAssertion[] = [
    {
      name: "webgpu-available",
      pass: result.gpu.webgpuAvailable,
    },
    {
      name: "graph-runs-ok",
      pass: result.graphReports.every((report) => report.status === "ok"),
    },
    {
      name: "leaf-count-positive",
      pass: result.terrain.leafCount > 0,
      detail: `leafCount=${result.terrain.leafCount}`,
    },
    {
      name: "leaf-count-within-capacity",
      pass: result.terrain.leafCount <= result.terrain.leafCapacity,
      detail: `leafCount=${result.terrain.leafCount} capacity=${result.terrain.leafCapacity}`,
    },
    {
      name: "query-ready",
      pass: result.terrain.queryGeneration > 0,
      detail: `generation=${result.terrain.queryGeneration}`,
    },
    {
      name: "samples-valid",
      pass: samplesValid,
      detail: `valid=${validSampleCount}/${result.terrain.samples.length}${
        sampleCullingActive ? " culling=active" : ""
      }`,
    },
    {
      name: "readback-has-no-nans",
      pass:
        result.readback.elevationNanCount === null ||
        (result.readback.elevationNanCount === 0 && result.readback.tileBoundsNanCount === 0),
    },
    {
      name: "task-errors-empty",
      pass: result.taskErrors.length === 0,
      detail: result.taskErrors.map((error) => error.message).join("; "),
    },
    {
      name: "frame-samples-present",
      pass: result.frames.samples.length === result.warmupFrames + result.measureFrames,
      detail: `samples=${result.frames.samples.length} expected=${
        result.warmupFrames + result.measureFrames
      }`,
    },
  ];

  const orbitSurfaceFrames = result.frames.samples.filter(
    (frame) => frame.measured && frame.cameraPathKind === "orbit-surface",
  );
  if (orbitSurfaceFrames.length > 0) {
    const firstFrame = orbitSurfaceFrames[0]!;
    const lastFrame = orbitSurfaceFrames[orbitSurfaceFrames.length - 1]!;
    assertions.push({
      name: "orbit-surface-path-complete",
      pass:
        lastFrame.pathProgress === 1 &&
        typeof firstFrame.altitudeMeters === "number" &&
        typeof lastFrame.altitudeMeters === "number" &&
        lastFrame.altitudeMeters < firstFrame.altitudeMeters,
      detail: `firstAltitude=${firstFrame.altitudeMeters} lastAltitude=${lastFrame.altitudeMeters} lastProgress=${lastFrame.pathProgress}`,
    });
  }

  if (result.computeBudgetMs !== null) {
    const computeSamples = result.gpuTimings.samples
      .map((sample) => sample.computeMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const maxComputeMs =
      computeSamples.length > 0 ? Math.max(...computeSamples) : Number.POSITIVE_INFINITY;
    assertions.push({
      name: "compute-budget",
      pass: maxComputeMs <= result.computeBudgetMs,
      detail: `maxComputeMs=${Number.isFinite(maxComputeMs) ? maxComputeMs.toFixed(6) : "unavailable"} budgetMs=${result.computeBudgetMs}`,
    });
  }

  return assertions;
}

async function collectGpuInfo(
  renderer: WebGPURenderer,
  timestampQueryEnabled: boolean,
): Promise<AgentGpuInfo> {
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  const adapterLike = adapter as GPUAdapter & {
    info?: { vendor?: string; architecture?: string; device?: string; description?: string };
  };
  const adapterName = adapterLike?.info
    ? [
        adapterLike.info.vendor,
        adapterLike.info.architecture,
        adapterLike.info.device,
        adapterLike.info.description,
      ]
        .filter(Boolean)
        .join(" ")
    : undefined;
  const backend = renderer as WebGPURenderer & {
    backend?: { device?: { features?: Set<string> } };
  };

  return {
    webgpuAvailable: Boolean(navigator.gpu),
    adapterName,
    adapterFeatures: adapter ? [...adapter.features].sort() : [],
    deviceFeatures: backend.backend?.device?.features
      ? [...backend.backend.device.features].sort()
      : [],
    computeLimits: getDeviceComputeLimits(renderer),
    timestampQueryEnabled,
    timestampDiagnostics: getTimestampDiagnostics(renderer),
  };
}

async function runAgentScenario(
  renderer: WebGPURenderer,
  input: AgentScenarioInput = {},
): Promise<AgentScenarioResult> {
  const scenario = applyScenarioOverrides(
    resolveScenario(input.scenario ?? "flat-sine-smoke"),
    input.overrides,
  );
  const warmupFrames = input.warmupFrames ?? scenario.defaultWarmupFrames ?? DEFAULT_WARMUP_FRAMES;
  const measureFrames =
    input.measureFrames ?? scenario.defaultMeasureFrames ?? DEFAULT_MEASURE_FRAMES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const computeBudgetMs = positiveNumberOverride(input.computeBudgetMs) ?? null;
  const profiler = createRendererGpuProfiler(renderer);
  const timestampQueryEnabled = profiler.enable();
  const graph = terrainGraph();
  const graphReports: RunReport[] = [];
  const measureEvents: GraphEvent[] = [];
  const taskErrorEvents: GraphEvent[] = [];
  const gpuTimingSamples: AgentGpuTimingSample[] = [];
  const frameSamples: AgentFrameSample[] = [];
  const startedAt = new Date().toISOString();
  const waitForReadbackEachFrame = scenario.cameraPath?.kind !== "orbit-surface";
  let recordEvents = false;

  const unsubscribe = graph.on("task:*", (event) => {
    if (event.type === "task:error") taskErrorEvents.push(event);
    if (recordEvents) measureEvents.push(event);
  });

  try {
    const totalFrames = warmupFrames + measureFrames;
    for (let frame = 0; frame < totalFrames; frame += 1) {
      recordEvents = frame >= warmupFrames;
      const frameStartedAt = performance.now();
      const cameraFrame = scenarioCameraFrame(scenario, frame, warmupFrames, measureFrames);
      const queryGeneration = graph.peek(terrainTasks.terrainQuery)?.cache.generation ?? -1;
      setScenarioParams(graph, scenario, cameraFrame);
      const pendingComputePasses: PendingComputePass[] = [];
      const restoreCompute = traceRendererCompute(renderer, pendingComputePasses);
      const taskErrorStart = taskErrorEvents.length;
      const report = await graph
        .run({
          targets: graphTargets(),
          laneConcurrency: { gpu: 1 },
          resources: { renderer },
        })
        .finally(restoreCompute);
      const graphRunWallMs = performance.now() - frameStartedAt;
      graphReports.push(report);
      if (report.status !== "ok") {
        const names = taskNameById(graph);
        const frameTaskErrors = taskErrorEvents.slice(taskErrorStart);
        const detail =
          frameTaskErrors
            .map((event) =>
              event.type === "task:error"
                ? `${names.get(event.taskId) ?? event.taskId}: ${eventMessage(event.error)}`
                : null,
            )
            .filter((value): value is string => value !== null)
            .join("; ") || `graph status ${report.status}`;
        throw new Error(`Graph run failed on frame ${frame} (${cameraFrame.phase}): ${detail}`);
      }
      if (waitForReadbackEachFrame) {
        await waitForQueryGeneration(graph, queryGeneration, timeoutMs);
      }
      const timing = await profiler.sample();
      const timingWithPasses = timing
        ? {
            ...timing,
            computePasses: resolveComputePassTimings(renderer, pendingComputePasses),
          }
        : null;
      if (frame >= warmupFrames && timing) {
        gpuTimingSamples.push(timingWithPasses!);
      }
      const frameLeafSet = graph.get(terrainTasks.visibleLeafSet).leaves;
      const frameLevelStats = summarizeLeafLevels(frameLeafSet, scenario.maxLevel);
      const frameIncremental = cloneIncrementalTelemetry(
        graph.get(terrainTasks.tileSlotUpdate).telemetry,
      );
      frameSamples.push({
        frame,
        measured: frame >= warmupFrames,
        phase: cameraFrame.phase,
        cameraPathKind: cameraFrame.cameraPathKind,
        pathProgress: cameraFrame.pathProgress,
        altitudeMeters: cameraFrame.altitudeMeters,
        cameraOrigin: [
          cameraFrame.cameraOrigin.x,
          cameraFrame.cameraOrigin.y,
          cameraFrame.cameraOrigin.z,
        ],
        wallMs: graphRunWallMs,
        leafCount: frameLeafSet.count,
        maxLeafLevel: frameLevelStats.max,
        leavesAtMaxLevel: frameLevelStats.leavesAtMaxLevel,
        incremental: frameIncremental,
        gpu: timingWithPasses,
      });
    }

    if (!waitForReadbackEachFrame) {
      await waitForQueryGeneration(graph, -1, timeoutMs);
    }

    const leafSet = graph.get(terrainTasks.visibleLeafSet).leaves;
    const incrementalTelemetry = cloneIncrementalTelemetry(
      graph.get(terrainTasks.tileSlotUpdate).telemetry,
    );
    const queryContext = graph.get(terrainTasks.terrainQuery);
    const edgeVertexCount = scenario.innerTileSegments + 3;
    const samples = scenario.samplePoints.map((point) => sampleTerrainPoint(queryContext, point));
    const readback = await collectReadback(
      renderer,
      graph,
      incrementalTelemetry.activeSlotCount ?? leafSet.count,
      edgeVertexCount,
      input.readback ?? true,
    );
    const timingSummary = summarizeTaskTimings(measureEvents, taskNameById(graph));
    const partialResult = {
      scenario: scenario.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      warmupFrames,
      measureFrames,
      computeBudgetMs,
      gpu: await collectGpuInfo(renderer, timestampQueryEnabled),
      graphReports,
      taskTimings: timingSummary.taskTimings,
      cacheHits: timingSummary.cacheHits,
      taskErrors: timingSummary.taskErrors,
      frames: {
        samples: frameSamples,
        summary: summarizeFrames(frameSamples),
      },
      terrain: {
        surfaceKind: scenario.surfaceKind,
        topologyKind: scenario.topology?.projection.kind ?? "flat",
        radius: scenario.radius,
        leafCount: leafSet.count,
        leafCapacity: leafSet.capacity,
        maxLevel: scenario.maxLevel,
        levelStats: summarizeLeafLevels(leafSet, scenario.maxLevel),
        innerTileSegments: scenario.innerTileSegments,
        incremental: incrementalTelemetry,
        elevationRange: queryContext.query.getGlobalElevationRange(),
        queryGeneration: queryContext.cache.generation,
        samples,
      },
      readback,
      gpuTimings: {
        supported:
          timestampQueryEnabled && gpuTimingSamples.some((sample) => sample.totalMs !== null),
        samples: gpuTimingSamples,
      },
    };
    const assertions = createAssertions(partialResult);
    return {
      ...partialResult,
      ok: assertions.every((assertion) => assertion.pass),
      assertions,
    };
  } finally {
    unsubscribe();
    graph.dispose();
  }
}

export function GpuAgentLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGPURenderer | null>(null);
  const [status, setStatus] = useState("initializing");
  const [lastResult, setLastResult] = useState<AgentScenarioResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const api = useMemo<AgentApi>(
    () => ({
      ready: false,
      async runScenario(input) {
        const renderer = rendererRef.current;
        if (!renderer) throw new Error("GPU agent lab renderer is not ready.");
        setStatus("running");
        setLastError(null);
        try {
          const result = await runAgentScenario(renderer, input);
          setLastResult(result);
          setStatus(result.ok ? "ok" : "failed");
          return result;
        } catch (error) {
          const message = eventMessage(error);
          setLastError(message);
          setStatus("error");
          throw error;
        }
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let renderer: WebGPURenderer | null = null;

    window.__helloTerrainAgent = api;

    async function init() {
      if (!navigator.gpu) {
        setStatus("webgpu-unavailable");
        return;
      }

      renderer = new THREE.WebGPURenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
        trackTimestamp: true,
      } as WebGPURendererParameters);
      renderer.setSize(64, 64, false);
      await renderer.init();
      if (disposed) {
        renderer.dispose();
        return;
      }
      rendererRef.current = renderer;
      api.ready = true;
      setStatus("ready");
    }

    void init().catch((error) => {
      setStatus("error");
      setLastError(eventMessage(error));
    });

    return () => {
      disposed = true;
      api.ready = false;
      rendererRef.current = null;
      if (window.__helloTerrainAgent === api) {
        window.__helloTerrainAgent = undefined;
      }
      renderer?.dispose();
    };
  }, [api]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          <p className="text-sm uppercase tracking-wide text-emerald-300">Agent GPU Lab</p>
          <h1 className="mt-2 text-3xl font-bold">Hello Terrain GPU Scenario Runner</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-300">
            This page initializes a real WebGPU renderer and exposes
            <code className="mx-1 rounded bg-neutral-800 px-1 py-0.5">
              window.__helloTerrainAgent.runScenario()
            </code>
            for automated GPU task inspection.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <section className="rounded border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-sm text-neutral-400">Status</div>
            <div className="mt-1 font-mono text-lg">{status}</div>
            <canvas
              ref={canvasRef}
              width={64}
              height={64}
              className="mt-4 h-16 w-16 border border-neutral-800"
            />
            <button
              type="button"
              className="mt-4 w-full rounded bg-emerald-500 px-3 py-2 text-sm font-bold text-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
              disabled={!api.ready || status === "running"}
              onClick={() => {
                void api.runScenario();
              }}
            >
              Run Smoke Scenario
            </button>
            {lastError ? (
              <pre className="mt-4 whitespace-pre-wrap text-xs text-red-300">{lastError}</pre>
            ) : null}
          </section>

          <section className="rounded border border-neutral-800 bg-neutral-900 p-4">
            <div className="mb-3 text-sm text-neutral-400">Last JSON Result</div>
            <pre className="max-h-[70vh] overflow-auto text-xs leading-5 text-neutral-200">
              {lastResult ? JSON.stringify(lastResult, null, 2) : "Awaiting runScenario()."}
            </pre>
          </section>
        </div>
      </div>
    </main>
  );
}
