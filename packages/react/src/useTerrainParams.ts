import {
  frustumCulling,
  elevationFn,
  elevationScale,
  hiZResolution,
  innerTileSegments,
  maxLevel,
  maxNodes,
  occlusionCulling,
  origin,
  rootSize,
  skirtScale,
  surface,
  terrainFieldFilter,
  type TerrainGraph,
} from "@hello-terrain/three";
import type { ParamRef } from "@hello-terrain/work";
import { useLayoutEffect, useRef } from "react";
import type { TerrainOptions } from "./types";

function resetOrSet<T>(
  graph: TerrainGraph,
  ownedParamIds: Set<string>,
  ref: ParamRef<T>,
  value: T | undefined,
  setValue: () => T,
) {
  if (value === undefined) {
    if (ownedParamIds.has(ref.id)) {
      graph.reset(ref);
      ownedParamIds.delete(ref.id);
    }
    return;
  }
  graph.set(ref, setValue);
  ownedParamIds.add(ref.id);
}

export function useTerrainParams(graph: TerrainGraph, options: TerrainOptions) {
  const ownedParamIdsRef = useRef<Set<string>>(new Set());
  const {
    rootSize: nextRootSize,
    origin: nextOrigin,
    maxLevel: nextMaxLevel,
    maxNodes: nextMaxNodes,
    innerTileSegments: nextInnerTileSegments,
    skirtScale: nextSkirtScale,
    elevationScale: nextElevationScale,
    elevation,
    surface: nextSurface,
    terrainFieldFilter: nextTerrainFieldFilter,
    frustumCulling: nextFrustumCulling,
    occlusionCulling: nextOcclusionCulling,
    hiZResolution: nextHiZResolution,
  } = options;

  useLayoutEffect(() => {
    ownedParamIdsRef.current.clear();
  }, [graph]);

  useLayoutEffect(() => {
    const ownedParamIds = ownedParamIdsRef.current;

    resetOrSet(
      graph,
      ownedParamIds,
      rootSize,
      nextRootSize,
      () => nextRootSize as number,
    );
    resetOrSet(graph, ownedParamIds, origin, nextOrigin, () => ({
      x: nextOrigin?.x ?? 0,
      y: nextOrigin?.y ?? 0,
      z: nextOrigin?.z ?? 0,
    }));
    resetOrSet(
      graph,
      ownedParamIds,
      maxLevel,
      nextMaxLevel,
      () => nextMaxLevel as number,
    );
    resetOrSet(
      graph,
      ownedParamIds,
      maxNodes,
      nextMaxNodes,
      () => nextMaxNodes as number,
    );
    resetOrSet(
      graph,
      ownedParamIds,
      innerTileSegments,
      nextInnerTileSegments,
      () => nextInnerTileSegments as number,
    );
    resetOrSet(
      graph,
      ownedParamIds,
      skirtScale,
      nextSkirtScale,
      () => nextSkirtScale as number,
    );
    resetOrSet(
      graph,
      ownedParamIds,
      elevationScale,
      nextElevationScale,
      () => nextElevationScale as number,
    );
    resetOrSet(
      graph,
      ownedParamIds,
      surface,
      nextSurface,
      () => nextSurface as Exclude<TerrainOptions["surface"], undefined>,
    );
    resetOrSet(
      graph,
      ownedParamIds,
      terrainFieldFilter,
      nextTerrainFieldFilter,
      () => nextTerrainFieldFilter as "nearest" | "linear",
    );
    resetOrSet(
      graph,
      ownedParamIds,
      frustumCulling,
      nextFrustumCulling,
      () => nextFrustumCulling as boolean,
    );
    resetOrSet(
      graph,
      ownedParamIds,
      occlusionCulling,
      nextOcclusionCulling,
      () => nextOcclusionCulling as boolean,
    );
    resetOrSet(
      graph,
      ownedParamIds,
      hiZResolution,
      nextHiZResolution,
      () => nextHiZResolution as number,
    );

    if (elevation === undefined) {
      if (ownedParamIds.has(elevationFn.id)) {
        graph.reset(elevationFn);
        ownedParamIds.delete(elevationFn.id);
      }
    } else {
      graph.set(elevationFn, () => elevation);
      ownedParamIds.add(elevationFn.id);
    }
  }, [
    graph,
    nextRootSize,
    nextOrigin,
    nextMaxLevel,
    nextMaxNodes,
    nextInnerTileSegments,
    nextSkirtScale,
    nextElevationScale,
    elevation,
    nextSurface,
    nextTerrainFieldFilter,
    nextFrustumCulling,
    nextOcclusionCulling,
    nextHiZResolution,
  ]);
}
