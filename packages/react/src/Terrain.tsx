import { TerrainMesh, terrainTasks } from "@hello-terrain/three";
import { useFrame } from "@react-three/fiber";
import { cloneElement, isValidElement, useEffect, useState } from "react";
import { TerrainProvider } from "./TerrainContext";
import type { TerrainHandle, TerrainPrimitiveProps, TerrainProps } from "./types";
import { useTerrain } from "./useTerrain";

function useTerrainMesh(
  innerTileSegments: number | undefined,
  maxNodes: number | undefined,
  flipWinding: boolean,
) {
  const [mesh] = useState(
    () =>
      new TerrainMesh({
        ...(innerTileSegments !== undefined ? { innerTileSegments } : {}),
        maxNodes: maxNodes ?? 1024,
        flipWinding,
      }),
  );

  useEffect(() => {
    mesh.maxNodes = maxNodes ?? 1024;
  }, [mesh, maxNodes]);

  useEffect(() => {
    mesh.flipWinding = flipWinding;
  }, [mesh, flipWinding]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
    };
  }, [mesh]);

  return mesh;
}

function syncTerrainMesh(mesh: TerrainMesh, terrain: TerrainHandle) {
  const leaves = terrain.graph.peek(terrainTasks.quadtreeUpdate);
  if (leaves && mesh.count !== leaves.count) {
    mesh.count = leaves.count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Keep the tile geometry resolution in sync with the effective
  // `innerTileSegments` param (prop-driven or set directly via `graph.set`).
  // The setter rebuilds the geometry only when the value actually changes.
  const uniforms = terrain.graph.peek(terrainTasks.updateUniforms);
  if (uniforms) {
    const segments = uniforms.uInnerTileSegments.value;
    if (typeof segments === "number") {
      mesh.innerTileSegments = segments;
    }
  }

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
  const flipWinding = terrain.topology?.projection?.faceOutward ?? false;
  const mesh = useTerrainMesh(innerTileSegments, maxNodes, flipWinding);
  const { visible: primitiveVisible = true, ...restPrimitiveProps } = primitiveProps;

  useFrame(() => {
    syncTerrainMesh(mesh, terrain);
  });

  return (
    <TerrainProvider value={terrain}>
      <primitive object={mesh} visible={terrain.ready && primitiveVisible} {...restPrimitiveProps}>
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
    radius,
    elevation,
    topology,
    terrainFieldFilter,
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
    radius,
    elevation,
    topology,
    terrainFieldFilter,
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
  radius,
  elevation,
  topology,
  terrainFieldFilter,
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
      radius={radius}
      elevation={elevation}
      topology={topology}
      terrainFieldFilter={terrainFieldFilter}
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
