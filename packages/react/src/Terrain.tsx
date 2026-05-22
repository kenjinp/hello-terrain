import { terrainTasks, TerrainMesh } from "@hello-terrain/three";
import { useFrame } from "@react-three/fiber";
import { cloneElement, isValidElement, useEffect, useState } from "react";
import { TerrainProvider } from "./TerrainContext";
import type {
  TerrainHandle,
  TerrainPrimitiveProps,
  TerrainProps,
} from "./types";
import { useTerrain } from "./useTerrain";

function useTerrainMesh(
  innerTileSegments: number | undefined,
  maxNodes: number | undefined,
) {
  const [mesh] = useState(
    () =>
      new TerrainMesh({
      innerTileSegments: innerTileSegments ?? 13,
      maxNodes: maxNodes ?? 1024,
    }),
  );

  useEffect(() => {
    mesh.innerTileSegments = innerTileSegments ?? 13;
  }, [mesh, innerTileSegments]);

  useEffect(() => {
    mesh.maxNodes = maxNodes ?? 1024;
  }, [mesh, maxNodes]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
    };
  }, [mesh]);

  return mesh;
}

function syncTerrainMesh(
  mesh: TerrainMesh,
  captureMesh: TerrainMesh,
  terrain: TerrainHandle,
) {
  const renderIndirection = terrain.graph.peek(terrainTasks.createRenderIndirection);
  if (renderIndirection) {
    mesh.setIndirectAttribute(renderIndirection.indirectAttribute);
    captureMesh.setIndirectAttribute(renderIndirection.indirectAttribute);
  }

  if (mesh.count !== mesh.maxNodes) {
    mesh.count = mesh.maxNodes;
  }
  if (captureMesh.count !== captureMesh.maxNodes) {
    captureMesh.count = captureMesh.maxNodes;
  }

  captureMesh.matrix.copy(mesh.matrixWorld);
  captureMesh.matrixWorld.copy(mesh.matrixWorld);

  const raycast = terrain.runtime.raycast;
  if (mesh.terrainRaycast !== raycast) {
    mesh.terrainRaycast = raycast;
  }
}

function attachTerrainMaterial(
  node: ReturnType<TerrainProps["children"]>,
  terrainNodes: Pick<TerrainHandle, "positionNode">,
) {
  if (!isValidElement<{ attach?: unknown }>(node)) return node;
  const nextKey = `terrain-material-${terrainNodes.positionNode?.id ?? "null"}`;
  if ("attach" in node.props && node.props.attach != null) {
    return cloneElement(node, { key: nextKey });
  }
  return cloneElement(node, { attach: "material", key: nextKey });
}

function TerrainWithHandle({
  terrain,
  children,
  innerTileSegments,
  maxNodes,
  ...primitiveProps
}: {
  terrain: TerrainHandle;
  children: TerrainProps["children"];
  innerTileSegments?: number;
  maxNodes?: number;
} & TerrainPrimitiveProps) {
  const mesh = useTerrainMesh(innerTileSegments, maxNodes);
  const captureMesh = useTerrainMesh(innerTileSegments, maxNodes);
  const { visible: primitiveVisible = true, ...restPrimitiveProps } =
    primitiveProps;

  useEffect(() => {
    captureMesh.matrixAutoUpdate = false;
    return () => {
      captureMesh.matrixAutoUpdate = true;
    };
  }, [captureMesh]);

  useEffect(() => {
    terrain.runtime.mesh = mesh;
    terrain.runtime.captureMesh = captureMesh;
    return () => {
      if (terrain.runtime.mesh === mesh) terrain.runtime.mesh = null;
      if (terrain.runtime.captureMesh === captureMesh) {
        terrain.runtime.captureMesh = null;
      }
    };
  }, [captureMesh, mesh, terrain]);

  useFrame(() => {
    syncTerrainMesh(mesh, captureMesh, terrain);
  });

  return (
    <TerrainProvider value={terrain}>
      <primitive
        object={mesh}
        visible={terrain.ready && primitiveVisible}
        {...restPrimitiveProps}
      >
        {terrain.ready
          ? attachTerrainMaterial(
              children({
                positionNode: terrain.positionNode,
              }),
              terrain,
            )
          : null}
      </primitive>
    </TerrainProvider>
  );
}

function InternalTerrain(props: Omit<TerrainProps, "terrain">) {
  const {
    children,
    rootSize,
    origin,
    maxLevel,
    innerTileSegments,
    skirtScale,
    elevationScale,
    elevation,
    surface,
    terrainFieldFilter,
    frustumCulling,
    occlusionCulling,
    hiZResolution,
    getCameraOrigin,
    cameraHysteresis,
    tasks,
    maxNodes,
    ...primitiveProps
  } = props;

  const terrain = useTerrain({
    rootSize,
    origin,
    maxLevel,
    innerTileSegments,
    skirtScale,
    elevationScale,
    elevation,
    surface,
    terrainFieldFilter,
    frustumCulling,
    occlusionCulling,
    hiZResolution,
    getCameraOrigin,
    cameraHysteresis,
    tasks,
    maxNodes,
  });

  return (
    <TerrainWithHandle
      terrain={terrain}
      innerTileSegments={innerTileSegments}
      maxNodes={maxNodes}
      {...primitiveProps}
    >
      {children}
    </TerrainWithHandle>
  );
}

export function Terrain({
  terrain: providedTerrain,
  children,
  rootSize,
  origin,
  maxLevel,
  innerTileSegments,
  skirtScale,
  elevationScale,
  elevation,
  surface,
  terrainFieldFilter,
  frustumCulling,
  occlusionCulling,
  hiZResolution,
  getCameraOrigin,
  cameraHysteresis,
  tasks,
  maxNodes,
  ...primitiveProps
}: TerrainProps) {
  if (providedTerrain) {
    return (
      <TerrainWithHandle
        terrain={providedTerrain}
        innerTileSegments={innerTileSegments}
        maxNodes={maxNodes}
        {...primitiveProps}
      >
        {children}
      </TerrainWithHandle>
    );
  }

  return (
    <InternalTerrain
      rootSize={rootSize}
      origin={origin}
      maxLevel={maxLevel}
      innerTileSegments={innerTileSegments}
      skirtScale={skirtScale}
      elevationScale={elevationScale}
      elevation={elevation}
      surface={surface}
      terrainFieldFilter={terrainFieldFilter}
      frustumCulling={frustumCulling}
      occlusionCulling={occlusionCulling}
      hiZResolution={hiZResolution}
      getCameraOrigin={getCameraOrigin}
      cameraHysteresis={cameraHysteresis}
      tasks={tasks}
      maxNodes={maxNodes}
      {...primitiveProps}
    >
      {children}
    </InternalTerrain>
  );
}
