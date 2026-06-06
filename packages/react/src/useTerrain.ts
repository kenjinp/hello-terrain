import { terrainGraph, terrainTasks } from "@hello-terrain/three"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  createSyncTerrainNodesTask,
  createSyncTerrainRuntimeTask,
} from "./runtimeTasks"
import type {
  TerrainHandle,
  TerrainNodes,
  TerrainOptions,
  TerrainRuntime,
  TerrainTask,
} from "./types"
import { useTerrainParams } from "./useTerrainParams"
import { useTerrainRunner } from "./useTerrainRunner"

export function useTerrain(options: TerrainOptions = {}): TerrainHandle {
  const runtime = useMemo<TerrainRuntime>(
    () => ({
      query: null,
      raycast: null,
    }),
    [],
  )
  const isMountedRef = useRef(true)
  const graphLifecycleRef = useRef(0)
  const terrainNodesRef = useRef<TerrainNodes>({
    positionNode: null,
  })
  const [terrainNodes, setTerrainNodes] = useState<TerrainNodes>(terrainNodesRef.current)
  const readyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const emitTerrainNodes = useCallback(
    (nextTerrainNodes: TerrainNodes) => {
      if (!isMountedRef.current) return
      setTerrainNodes((prevTerrainNodes) => {
        if (prevTerrainNodes.positionNode === nextTerrainNodes.positionNode) {
          terrainNodesRef.current = prevTerrainNodes
          return prevTerrainNodes
        }
        terrainNodesRef.current = nextTerrainNodes
        return nextTerrainNodes
      })
    },
    [],
  )
  const getTerrainNodes = useCallback(
    () => terrainNodesRef.current,
    [],
  )
  const emitReady = useCallback((nextReady: boolean) => {
    if (!isMountedRef.current) return
    readyRef.current = nextReady
    setReady((prevReady) => (prevReady === nextReady ? prevReady : nextReady))
  }, [])
  const getReady = useCallback(
    () => readyRef.current,
    [],
  )
  const syncTerrainRuntimeTask = useMemo(
    () => createSyncTerrainRuntimeTask(runtime),
    [runtime],
  )
  const syncTerrainNodesTask = useMemo(
    () =>
      createSyncTerrainNodesTask(
        getTerrainNodes,
        emitTerrainNodes,
        getReady,
        emitReady,
      ),
    [emitReady, emitTerrainNodes, getReady, getTerrainNodes],
  )
  const graph = useMemo(() => {
    const nextGraph = terrainGraph()

    for (const task of options.tasks ?? []) {
      nextGraph.add(task)
    }

    nextGraph.add(syncTerrainRuntimeTask)
    nextGraph.add(syncTerrainNodesTask)

    return nextGraph
  }, [options.tasks, syncTerrainNodesTask, syncTerrainRuntimeTask])
  const runnerTargets = useMemo(
    () => {
      const userTasks = options.tasks ?? []
      return [
        ...userTasks,
        terrainTasks.executeCompute,
        terrainTasks.terrainReadback,
        terrainTasks.gpuSpatialIndexUpload,
        syncTerrainRuntimeTask,
        syncTerrainNodesTask,
      ] satisfies readonly TerrainTask[]
    },
    [options.tasks, syncTerrainNodesTask, syncTerrainRuntimeTask],
  )
  const stopTerrainRunner = useTerrainRunner({
    graph,
    targets: runnerTargets,
    getCameraOrigin: options.getCameraOrigin,
    cameraHysteresis: options.cameraHysteresis,
  })

  useEffect(() => {
    graphLifecycleRef.current += 1
    const lifecycle = graphLifecycleRef.current
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      queueMicrotask(() => {
        if (graphLifecycleRef.current !== lifecycle) return
        void stopTerrainRunner().finally(() => {
          if (graphLifecycleRef.current !== lifecycle) return
          graph.dispose()
        })
      })
    }
  }, [graph, stopTerrainRunner])

  useLayoutEffect(() => {
    runtime.query = null
    runtime.raycast = null
    const nextTerrainNodes = {
      positionNode: null,
    } satisfies TerrainNodes
    terrainNodesRef.current = nextTerrainNodes
    readyRef.current = false
    setTerrainNodes(nextTerrainNodes)
    setReady(false)
  }, [graph, runtime])

  useTerrainParams(graph, options)

  return useMemo(
    () => ({
      graph,
      tasks: terrainTasks,
      runtime,
      ready,
      ...terrainNodes,
    }),
    [graph, ready, runtime, terrainNodes],
  )
}
