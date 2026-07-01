import { TerrainMesh, terrainTasks } from "@hello-terrain/three";
import { useFrame } from "@react-three/fiber";
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useState } from "react";
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
  const leafBuffer = terrain.graph.peek(terrainTasks.leafGpuBuffer);
  const visibleCount =
    leafBuffer?.count ?? terrain.graph.peek(terrainTasks.visibleLeafSet)?.leaves.count;
  if (visibleCount !== undefined && mesh.count !== visibleCount) {
    mesh.count = visibleCount;
    mesh.instanceMatrix.needsUpdate = true;
  }

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
  culling,
  innerTileSegments,
  maxNodes,
  ...primitiveProps
}: {
  terrain: TerrainHandle;
  children: TerrainProps["children"];
  culling?: TerrainProps["culling"];
  innerTileSegments?: number;
  maxNodes?: number;
} & TerrainPrimitiveProps) {
  const flipWinding = terrain.topology?.projection?.faceOutward ?? false;
  const mesh = useTerrainMesh(innerTileSegments, maxNodes, flipWinding);
  const { visible: primitiveVisible = true, ...restPrimitiveProps } = primitiveProps;

  useLayoutEffect(() => {
    const camera = culling?.camera;
    if (camera === undefined) return;
    terrain.bindCamera?.(camera);
    return () => {
      terrain.bindCamera?.(undefined);
    };
  }, [culling?.camera, terrain]);

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
    culling,
    residency,
    lod,
    pipeline,
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
    culling,
    residency,
    lod,
    pipeline,
    tasks,
    maxNodes,
  });

  return (
    <TerrainWithHandle
      terrain={terrain}
      culling={culling}
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
  culling,
  residency,
  lod,
  pipeline,
  tasks,
  maxNodes,
  ...primitiveProps
}: TerrainProps) {
  if (providedTerrain) {
    return (
      <TerrainWithHandle
        terrain={providedTerrain}
        culling={culling}
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
      culling={culling}
      residency={residency}
      lod={lod}
      pipeline={pipeline}
      tasks={tasks}
      maxNodes={maxNodes}
      {...primitiveProps}
    >
      {children}
    </InternalTerrain>
  );
}
