import { terrainTasks } from "@hello-terrain/three";
import { task } from "@hello-terrain/work";
import type { WebGPURenderer } from "three/webgpu";
import type { TerrainNodes, TerrainRuntime } from "./types";

export function createSyncTerrainRuntimeTask(runtime: TerrainRuntime) {
  return task<{ renderer: WebGPURenderer }>((get, work) => {
    const query = get(terrainTasks.terrainQuery).query;
    const raycast = get(terrainTasks.terrainRaycast);

    return work(() => {
      runtime.query = query;
      runtime.raycast = raycast;
      return runtime;
    });
  })
    .displayName("syncTerrainRuntimeTask")
    .cache("none");
}

export function createSyncTerrainNodesTask(
  getTerrainNodes: () => TerrainNodes,
  setTerrainNodes: (terrainNodes: TerrainNodes) => void,
  getReady: () => boolean,
  setReady: (ready: boolean) => void,
) {
  return task<{ renderer: WebGPURenderer }>((get, work) => {
    const positionNode = get(terrainTasks.positionNode);

    return work(() => {
      const nextReady = positionNode != null;
      const terrainNodes = getTerrainNodes();
      if (terrainNodes.positionNode !== positionNode) {
        setTerrainNodes({
          positionNode,
        });
      }
      if (getReady() !== nextReady) {
        setReady(nextReady);
      }

      return {
        positionNode,
        ready: nextReady,
      };
    });
  })
    .displayName("syncTerrainNodesTask")
    .cache("none");
}
