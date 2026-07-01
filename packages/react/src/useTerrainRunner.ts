import {
  cameraView,
  cloneResidencyAnchors,
  createCameraViewEquals,
  createResidencyAnchorsEquals,
  DEFAULT_CAMERA_ORIGIN_HYSTERESIS,
  DEFAULT_RESIDENCY_HYSTERESIS,
  readCameraView,
  residencyAnchors,
  type CameraView,
  type TerrainGraph,
} from "@hello-terrain/three";
import { useFrame, type RootState } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Vector3, type Camera } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { TerrainOptions, TerrainTask, TerrainVector3Like } from "./types";

const WEBGPU_RENDERER_ERROR =
  "@hello-terrain/react requires a WebGPURenderer on <Canvas gl={...}>.";
const GRAPH_RUN_ERROR = "@hello-terrain/react terrain graph run failed.";

export interface UseTerrainRunnerParams {
  graph: TerrainGraph;
  targets?: readonly TerrainTask[];
  cameraRef: RefObject<Camera | undefined>;
  culling?: TerrainOptions["culling"];
  residency?: TerrainOptions["residency"];
}

function resolveActiveCamera(state: RootState, cameraRef: RefObject<Camera | undefined>): Camera {
  return cameraRef.current ?? state.camera;
}

function toVector3Like(
  state: RootState,
  activeCamera: Camera,
  getCameraOrigin?: TerrainOptions["culling"] extends infer C
    ? C extends { getCameraOrigin?: infer G }
      ? G
      : never
    : never,
): TerrainVector3Like {
  return getCameraOrigin?.(state) ?? activeCamera.position;
}

function isWebGpuRenderer(renderer: unknown): renderer is WebGPURenderer {
  return typeof renderer === "object" && renderer !== null && "backend" in renderer;
}

function getTerrainRunnerErrorKey(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}:${error.message}`;
  }
  return String(error);
}

function shouldPreGateCamera(originHysteresis: number | undefined) {
  return (
    originHysteresis !== undefined && originHysteresis !== DEFAULT_CAMERA_ORIGIN_HYSTERESIS
  );
}

function shouldPreGateResidency(hysteresis: number | undefined) {
  return hysteresis !== undefined && hysteresis !== DEFAULT_RESIDENCY_HYSTERESIS;
}

export function useTerrainRunner({
  graph,
  targets,
  cameraRef,
  culling,
  residency,
}: UseTerrainRunnerParams) {
  const graphRef = useRef(graph);
  const targetsRef = useRef(targets);
  const cameraRefRef = useRef(cameraRef);
  const cullingRef = useRef(culling);
  const residencyRef = useRef(residency);
  const scratchCameraOriginRef = useRef(new Vector3());
  const scratchCameraViewRef = useRef<CameraView>({
    cameraOrigin: { x: 0, y: 0, z: 0 },
    viewProjectionMatrix: new Float64Array(16),
  });
  const lastCameraViewRef = useRef<CameraView | null>(null);
  const lastResidencyAnchorsRef = useRef<ReturnType<typeof cloneResidencyAnchors> | null>(null);
  const lastErrorKeyRef = useRef<string | null>(null);

  const cameraViewEqualsFn = useMemo(
    () => createCameraViewEquals({ originHysteresis: culling?.originHysteresis }),
    [culling?.originHysteresis],
  );
  const residencyAnchorsEqualsFn = useMemo(
    () => createResidencyAnchorsEquals({ hysteresis: residency?.hysteresis }),
    [residency?.hysteresis],
  );

  useLayoutEffect(() => {
    graphRef.current = graph;
    targetsRef.current = targets;
    cameraRefRef.current = cameraRef;
    cullingRef.current = culling;
    residencyRef.current = residency;
    lastCameraViewRef.current = null;
    lastResidencyAnchorsRef.current = null;
    lastErrorKeyRef.current = null;
  }, [cameraRef, culling, graph, residency, targets]);

  useFrame((state) => {
    const renderer = state.gl;
    if (!isWebGpuRenderer(renderer)) {
      const errorKey = `renderer:${WEBGPU_RENDERER_ERROR}`;
      if (lastErrorKeyRef.current !== errorKey) {
        lastErrorKeyRef.current = errorKey;
        console.error(new Error(WEBGPU_RENDERER_ERROR));
      }
      return;
    }

    const activeGraph = graphRef.current;
    const activeCulling = cullingRef.current;
    const activeResidency = residencyRef.current;
    const activeCamera = resolveActiveCamera(state, cameraRefRef.current);
    const cameraOrigin = toVector3Like(state, activeCamera, activeCulling?.getCameraOrigin);
    const nextOrigin = scratchCameraOriginRef.current;
    nextOrigin.set(cameraOrigin.x, cameraOrigin.y, cameraOrigin.z);

    const nextCameraView = readCameraView(
      activeCamera,
      scratchCameraViewRef.current,
      nextOrigin,
    );
    const lastCameraView = lastCameraViewRef.current;
    const preGateCamera = shouldPreGateCamera(activeCulling?.originHysteresis);
    const cameraUnchanged =
      preGateCamera &&
      lastCameraView !== null &&
      cameraViewEqualsFn(lastCameraView, nextCameraView);

    if (!cameraUnchanged) {
      activeGraph.set(cameraView, {
        cameraOrigin: {
          x: nextCameraView.cameraOrigin.x,
          y: nextCameraView.cameraOrigin.y,
          z: nextCameraView.cameraOrigin.z,
        },
        viewProjectionMatrix: nextCameraView.viewProjectionMatrix,
      });
      if (preGateCamera) {
        if (!lastCameraViewRef.current) {
          lastCameraViewRef.current = {
            cameraOrigin: { x: 0, y: 0, z: 0 },
            viewProjectionMatrix: new Float64Array(16),
          };
        }
        const last = lastCameraViewRef.current;
        last.cameraOrigin.x = nextCameraView.cameraOrigin.x;
        last.cameraOrigin.y = nextCameraView.cameraOrigin.y;
        last.cameraOrigin.z = nextCameraView.cameraOrigin.z;
        for (let i = 0; i < 16; i += 1) {
          last.viewProjectionMatrix[i] = nextCameraView.viewProjectionMatrix[i] ?? 0;
        }
      }
    }

    const nextResidencyAnchors = cloneResidencyAnchors(
      activeResidency?.getAnchors?.(state),
    );
    const lastResidencyAnchors = lastResidencyAnchorsRef.current;
    const preGateResidency = shouldPreGateResidency(activeResidency?.hysteresis);
    const residencyUnchanged =
      preGateResidency &&
      lastResidencyAnchors !== null &&
      residencyAnchorsEqualsFn(lastResidencyAnchors, nextResidencyAnchors);

    if (!residencyUnchanged) {
      activeGraph.set(residencyAnchors, nextResidencyAnchors);
      if (preGateResidency) {
        lastResidencyAnchorsRef.current = cloneResidencyAnchors(nextResidencyAnchors);
      }
    }

    void activeGraph
      .run({
        targets: targetsRef.current,
        resources: { renderer },
      })
      .then((report) => {
        if (report.status === "error") {
          const errorKey = `graph:${GRAPH_RUN_ERROR}`;
          if (lastErrorKeyRef.current !== errorKey) {
            lastErrorKeyRef.current = errorKey;
            console.error(new Error(GRAPH_RUN_ERROR));
          }
          return;
        }
        lastErrorKeyRef.current = null;
      })
      .catch((error) => {
        const errorKey = getTerrainRunnerErrorKey(error);
        if (lastErrorKeyRef.current === errorKey) return;
        lastErrorKeyRef.current = errorKey;
        console.error(error);
      });
  });
}
