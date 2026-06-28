import {
  quadtreeUpdate,
  writeUpdateParamsFromCamera,
  type TerrainResidencyAnchor,
  type TerrainGraph,
} from "@hello-terrain/three";
import { useFrame, type RootState } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef } from "react";
import { Vector3 } from "three";
import {
  copyMatrix16,
  didCameraOriginMove,
  didViewProjectionMatrixChange,
  writeCameraViewProjectionMatrix,
} from "./cameraSync";
import type { WebGPURenderer } from "three/webgpu";
import type { TerrainOptions, TerrainTask, TerrainVector3Like } from "./types";

const WEBGPU_RENDERER_ERROR =
  "@hello-terrain/react requires a WebGPURenderer on <Canvas gl={...}>.";
const GRAPH_RUN_ERROR = "@hello-terrain/react terrain graph run failed.";

export interface UseTerrainRunnerParams {
  graph: TerrainGraph;
  targets?: readonly TerrainTask[];
  getCameraOrigin?: TerrainOptions["getCameraOrigin"];
  getResidencyAnchors?: TerrainOptions["getResidencyAnchors"];
  residencyHysteresis?: number;
  cameraHysteresis?: number;
}

function toVector3Like(
  state: RootState,
  getCameraOrigin?: TerrainOptions["getCameraOrigin"],
): TerrainVector3Like {
  return getCameraOrigin?.(state) ?? state.camera.position;
}

function getTerrainRunnerErrorKey(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}:${error.message}`;
  }
  return String(error);
}

function cloneResidencyAnchors(
  anchors: readonly TerrainResidencyAnchor[] | undefined,
): TerrainResidencyAnchor[] | undefined {
  if (!anchors || anchors.length === 0) return undefined;
  return anchors.map((anchor) => ({
    position: {
      x: anchor.position.x,
      y: anchor.position.y,
      z: anchor.position.z,
    },
    radius: anchor.radius,
  }));
}

function didResidencyAnchorsChange(
  last: readonly TerrainResidencyAnchor[] | null,
  next: readonly TerrainResidencyAnchor[] | undefined,
  hysteresis: number,
) {
  const nextCount = next?.length ?? 0;
  if (!last) return nextCount > 0;
  if (last.length !== nextCount) return true;
  const thresholdSq = hysteresis * hysteresis;
  for (let i = 0; i < nextCount; i += 1) {
    const a = last[i];
    const b = next?.[i];
    if (!a || !b) return true;
    if (Math.abs(a.radius - b.radius) > hysteresis) return true;
    const dx = a.position.x - b.position.x;
    const dy = a.position.y - b.position.y;
    const dz = a.position.z - b.position.z;
    if (dx * dx + dy * dy + dz * dz > thresholdSq) return true;
  }
  return false;
}

function isWebGpuRenderer(renderer: unknown): renderer is WebGPURenderer {
  return (
    typeof renderer === "object" && renderer !== null && "backend" in renderer
  );
}

export function useTerrainRunner({
  graph,
  targets,
  getCameraOrigin,
  getResidencyAnchors,
  residencyHysteresis = 0.05,
  cameraHysteresis = 0.05,
}: UseTerrainRunnerParams) {
  const graphRef = useRef(graph);
  const targetsRef = useRef(targets);
  const getCameraOriginRef = useRef(getCameraOrigin);
  const getResidencyAnchorsRef = useRef(getResidencyAnchors);
  const lastCameraOriginRef = useRef<Vector3 | null>(null);
  const lastViewProjectionMatrixRef = useRef<Float64Array | null>(null);
  const lastResidencyAnchorsRef = useRef<TerrainResidencyAnchor[] | null>(null);
  const scratchViewProjectionMatrixRef = useRef<Float64Array>(new Float64Array(16));
  const runningRef = useRef(false);
  const generationRef = useRef(0);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const runPromiseRef = useRef<Promise<void> | null>(null);
  const lastErrorKeyRef = useRef<string | null>(null);

  const reportError = useCallback(
    (error: Error | unknown, errorKey?: string) => {
      const nextErrorKey = errorKey ?? getTerrainRunnerErrorKey(error);
      if (lastErrorKeyRef.current === nextErrorKey) return;
      lastErrorKeyRef.current = nextErrorKey;
      console.error(error);
    },
    [],
  );

  const clearError = useCallback(() => {
    lastErrorKeyRef.current = null;
  }, []);

  const stopCurrentRun = useCallback(async () => {
    const activeController = runAbortControllerRef.current;
    if (activeController && !activeController.signal.aborted) {
      activeController.abort(new Error("Terrain runner stopped"));
    }
    const activeRun = runPromiseRef.current;
    if (activeRun) {
      await activeRun.catch(() => {});
    }
  }, []);

  const updateCameraParams = useCallback(
    (state: RootState, activeGraph: TerrainGraph) => {
      const activeGetCameraOrigin = getCameraOriginRef.current;
      const activeGetResidencyAnchors = getResidencyAnchorsRef.current;
      const cameraOrigin = toVector3Like(state, activeGetCameraOrigin);
      const nextOrigin = new Vector3(
        cameraOrigin.x,
        cameraOrigin.y,
        cameraOrigin.z,
      );
      const nextViewProjectionMatrix = scratchViewProjectionMatrixRef.current;
      writeCameraViewProjectionMatrix(state.camera, nextViewProjectionMatrix);
      const nextResidencyAnchors = cloneResidencyAnchors(
        activeGetResidencyAnchors?.(state),
      );

      if (
        didCameraOriginMove(
          lastCameraOriginRef.current,
          nextOrigin,
          cameraHysteresis,
        ) ||
        didViewProjectionMatrixChange(
          lastViewProjectionMatrixRef.current,
          nextViewProjectionMatrix,
        ) ||
        didResidencyAnchorsChange(
          lastResidencyAnchorsRef.current,
          nextResidencyAnchors,
          residencyHysteresis,
        )
      ) {
        activeGraph.set(quadtreeUpdate, (prev) => {
          const next = writeUpdateParamsFromCamera(prev, state.camera, nextOrigin);
          next.residency = nextResidencyAnchors
            ? { anchors: nextResidencyAnchors }
            : undefined;
          return next;
        });
        lastCameraOriginRef.current = nextOrigin;
        if (!lastViewProjectionMatrixRef.current) {
          lastViewProjectionMatrixRef.current = new Float64Array(16);
        }
        copyMatrix16(lastViewProjectionMatrixRef.current, nextViewProjectionMatrix);
        lastResidencyAnchorsRef.current = nextResidencyAnchors
          ? cloneResidencyAnchors(nextResidencyAnchors) ?? null
          : [];
      }
    },
    [cameraHysteresis, residencyHysteresis],
  );

  const finishRun = useCallback(
    (activeRunController: AbortController, activeGeneration: number) => {
      if (runAbortControllerRef.current === activeRunController) {
        runAbortControllerRef.current = null;
        runPromiseRef.current = null;
      }
      if (generationRef.current === activeGeneration) {
        runningRef.current = false;
      }
    },
    [],
  );

  useLayoutEffect(() => {
    void stopCurrentRun();
    graphRef.current = graph;
    targetsRef.current = targets;
    getCameraOriginRef.current = getCameraOrigin;
    getResidencyAnchorsRef.current = getResidencyAnchors;
    lastCameraOriginRef.current = null;
    lastViewProjectionMatrixRef.current = null;
    lastResidencyAnchorsRef.current = null;
    runningRef.current = false;
    generationRef.current += 1;
    clearError();
    return () => {
      generationRef.current += 1;
      runningRef.current = false;
      void stopCurrentRun();
    };
  }, [clearError, getCameraOrigin, getResidencyAnchors, graph, stopCurrentRun, targets]);

  useFrame((state) => {
    if (runningRef.current) return;

    const renderer = state.gl;
    if (!isWebGpuRenderer(renderer)) {
      reportError(
        new Error(WEBGPU_RENDERER_ERROR),
        `renderer:${WEBGPU_RENDERER_ERROR}`,
      );
      return;
    }

    const activeGeneration = generationRef.current;
    const activeRunController = new AbortController();
    runningRef.current = true;
    runAbortControllerRef.current = activeRunController;

    const runPromise = (async () => {
      try {
        const activeGraph = graphRef.current;
        const activeTargets = targetsRef.current;
        updateCameraParams(state, activeGraph);

        const report = await activeGraph.run({
          targets: activeTargets,
          signal: activeRunController.signal,
          resources: {
            renderer,
          },
        });
        if (report.status === "error") {
          reportError(new Error(GRAPH_RUN_ERROR), `graph:${GRAPH_RUN_ERROR}`);
          return;
        }
        clearError();
      } catch (error) {
        if (activeRunController.signal.aborted) return;
        reportError(error);
      } finally {
        finishRun(activeRunController, activeGeneration);
      }
    })();

    runPromiseRef.current = runPromise;
  });

  return stopCurrentRun;
}
