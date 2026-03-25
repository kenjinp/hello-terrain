import { quadtreeUpdate, type TerrainGraph } from "@hello-terrain/three";
import { useFrame, type RootState } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef } from "react";
import { Vector3 } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { TerrainOptions, TerrainTask, TerrainVector3Like } from "./types";

const WEBGPU_RENDERER_ERROR =
  "@hello-terrain/react requires a WebGPURenderer on <Canvas gl={...}>.";
const GRAPH_RUN_ERROR = "@hello-terrain/react terrain graph run failed.";

export interface UseTerrainRunnerParams {
  graph: TerrainGraph;
  targets?: readonly TerrainTask[];
  getCameraOrigin?: TerrainOptions["getCameraOrigin"];
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

function isWebGpuRenderer(renderer: unknown): renderer is WebGPURenderer {
  return (
    typeof renderer === "object" && renderer !== null && "backend" in renderer
  );
}

export function useTerrainRunner({
  graph,
  targets,
  getCameraOrigin,
  cameraHysteresis = 0.05,
}: UseTerrainRunnerParams) {
  const graphRef = useRef(graph);
  const targetsRef = useRef(targets);
  const getCameraOriginRef = useRef(getCameraOrigin);
  const lastCameraOriginRef = useRef<Vector3 | null>(null);
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

  const updateCameraOrigin = useCallback(
    (state: RootState, activeGraph: TerrainGraph) => {
      const activeGetCameraOrigin = getCameraOriginRef.current;
      const cameraOrigin = toVector3Like(state, activeGetCameraOrigin);
      const nextOrigin = new Vector3(
        cameraOrigin.x,
        cameraOrigin.y,
        cameraOrigin.z,
      );
      const lastOrigin = lastCameraOriginRef.current;
      const hysteresisSq = cameraHysteresis * cameraHysteresis;

      if (
        !lastOrigin ||
        lastOrigin.distanceToSquared(nextOrigin) >= hysteresisSq
      ) {
        activeGraph.set(quadtreeUpdate, (prev) => {
          prev.cameraOrigin.x = nextOrigin.x;
          prev.cameraOrigin.y = nextOrigin.y;
          prev.cameraOrigin.z = nextOrigin.z;
          return prev;
        });
        lastCameraOriginRef.current = nextOrigin;
      }
    },
    [cameraHysteresis],
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
    lastCameraOriginRef.current = null;
    runningRef.current = false;
    generationRef.current += 1;
    clearError();
    return () => {
      generationRef.current += 1;
      runningRef.current = false;
      void stopCurrentRun();
    };
  }, [clearError, getCameraOrigin, graph, stopCurrentRun, targets]);

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
        updateCameraOrigin(state, activeGraph);

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
