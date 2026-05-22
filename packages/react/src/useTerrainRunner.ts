import {
  cameraProjectionMatrix,
  cameraProjectionViewMatrix,
  cameraViewMatrix,
  quadtreeUpdate,
  terrainTasks,
  type TerrainGraph,
} from "@hello-terrain/three";
import { useFrame, type RootState } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef } from "react";
import { Matrix4, Vector3 } from "three";
import { float, positionView, vec4 } from "three/tsl";
import {
  MeshBasicNodeMaterial,
  Scene,
  type WebGPURenderer,
} from "three/webgpu";
import type {
  TerrainOptions,
  TerrainRuntime,
  TerrainTask,
  TerrainVector3Like,
} from "./types";

const WEBGPU_RENDERER_ERROR =
  "@hello-terrain/react requires a WebGPURenderer on <Canvas gl={...}>.";
const GRAPH_RUN_ERROR = "@hello-terrain/react terrain graph run failed.";

export interface UseTerrainRunnerParams {
  graph: TerrainGraph;
  runtime: TerrainRuntime;
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
  runtime,
  targets,
  getCameraOrigin,
  cameraHysteresis = 0.05,
}: UseTerrainRunnerParams) {
  const graphRef = useRef(graph);
  const runtimeRef = useRef(runtime);
  const targetsRef = useRef(targets);
  const getCameraOriginRef = useRef(getCameraOrigin);
  const lastCameraOriginRef = useRef<Vector3 | null>(null);
  const projectionViewMatrixRef = useRef(new Matrix4());
  const captureSceneRef = useRef<Scene | null>(null);
  const captureMaterialRef = useRef<MeshBasicNodeMaterial | null>(null);
  const lastTaskErrorRef = useRef<{
    taskId: string
    error: unknown
  } | null>(null);
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

  const updateCameraState = useCallback(
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

      const projectionViewMatrix = projectionViewMatrixRef.current
        .copy(state.camera.projectionMatrix)
        .multiply(state.camera.matrixWorldInverse);

      activeGraph.set(cameraProjectionMatrix, (prev) => {
        prev.set(state.camera.projectionMatrix.elements);
        return prev;
      });
      activeGraph.set(cameraProjectionViewMatrix, (prev) => {
        prev.set(projectionViewMatrix.elements);
        return prev;
      });
      activeGraph.set(cameraViewMatrix, (prev) => {
        prev.set(state.camera.matrixWorldInverse.elements);
        return prev;
      });
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
    runtimeRef.current = runtime;
    targetsRef.current = targets;
    getCameraOriginRef.current = getCameraOrigin;
    lastCameraOriginRef.current = null;
    runningRef.current = false;
    generationRef.current += 1;
    clearError();
    lastTaskErrorRef.current = null;
    const unsubscribe = graph.on("task:error", (event) => {
      lastTaskErrorRef.current = {
        taskId: event.taskId,
        error: event.error,
      }
    });
    return () => {
      unsubscribe();
      generationRef.current += 1;
      runningRef.current = false;
      void stopCurrentRun();
    };
  }, [clearError, getCameraOrigin, graph, runtime, stopCurrentRun, targets]);

  useLayoutEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useLayoutEffect(() => {
    return () => {
      captureMaterialRef.current?.dispose();
      captureMaterialRef.current = null;
      captureSceneRef.current = null;
    };
  }, []);

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
        updateCameraState(state, activeGraph);

        const report = await activeGraph.run({
          targets: activeTargets,
          signal: activeRunController.signal,
          resources: {
            renderer,
            captureTerrainDepth: (target) => {
              const captureMesh = runtimeRef.current.captureMesh
              const positionNode = activeGraph.peek(terrainTasks.positionNode)
              if (!captureMesh || !positionNode) return

              let captureScene = captureSceneRef.current
              if (!captureScene) {
                captureScene = new Scene()
                captureSceneRef.current = captureScene
              }
              if (captureMesh.parent !== captureScene) {
                captureScene.clear()
                captureScene.add(captureMesh)
              }

              let captureMaterial = captureMaterialRef.current
              if (!captureMaterial) {
                captureMaterial = new MeshBasicNodeMaterial()
                captureMaterial.colorNode = vec4(
                  positionView.z.negate(),
                  float(0),
                  float(0),
                  float(1),
                )
                captureMaterialRef.current = captureMaterial
              }

              captureMaterial.positionNode = positionNode
              const previousMaterial = captureMesh.material
              captureMesh.material = captureMaterial
              renderer.setRenderTarget(target)
              renderer.clear()
              renderer.render(captureScene, state.camera)
              renderer.setRenderTarget(null)
              captureMesh.material = previousMaterial
            },
          },
        });
        if (report.status === "error") {
          const taskError = lastTaskErrorRef.current;
          if (taskError) {
            reportError(
              taskError.error,
              `graph-task:${taskError.taskId}:${getTerrainRunnerErrorKey(taskError.error)}`,
            );
          } else {
            reportError(new Error(GRAPH_RUN_ERROR), `graph:${GRAPH_RUN_ERROR}`);
          }
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
