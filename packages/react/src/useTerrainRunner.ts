import { quadtreeUpdate, type TerrainGraph } from "@hello-terrain/three";
import { useFrame, type RootState } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { Vector3 } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { TerrainOptions, TerrainTask, TerrainVector3Like } from "./types";

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

  useLayoutEffect(() => {
    graphRef.current = graph;
    targetsRef.current = targets;
    getCameraOriginRef.current = getCameraOrigin;
    lastCameraOriginRef.current = null;
    runningRef.current = false;
    generationRef.current += 1;
  }, [graph, targets, getCameraOrigin]);

  useFrame((state) => {
    if (runningRef.current) return;
    const activeGeneration = generationRef.current;
    runningRef.current = true;

    void (async () => {
      try {
        const activeGraph = graphRef.current;
        const activeTargets = targetsRef.current;
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

        await activeGraph.run({
          targets: activeTargets,
          resources: {
            renderer: state.gl as unknown as WebGPURenderer,
          },
        });
      } finally {
        if (generationRef.current === activeGeneration) {
          runningRef.current = false;
        }
      }
    })();
  });
}
