import {
  elevationFn,
  elevationScale,
  innerTileSegments,
  maxLevel,
  maxNodes,
  origin,
  radius,
  rootSize,
  skirtScale,
  terrainFieldFilter,
  topology,
  textureFn,
  textureSet,
  textureRender,
  textureReadback,
  type TerrainGraph,
} from "@hello-terrain/three";
import type { ParamRef } from "@hello-terrain/work";
import { useLayoutEffect, useRef } from "react";
import type { TerrainOptions } from "./types";

function resetOrSet<T>(
  graph: TerrainGraph,
  appliedValues: Map<string, unknown>,
  ref: ParamRef<T>,
  value: T | undefined,
  setValue: () => T,
) {
  if (value === undefined) {
    if (appliedValues.has(ref.id)) {
      graph.reset(ref);
      appliedValues.delete(ref.id);
    }
    return;
  }
  if (appliedValues.has(ref.id) && Object.is(appliedValues.get(ref.id), value)) return;
  graph.set(ref, setValue);
  appliedValues.set(ref.id, value);
}

export function useTerrainParams(graph: TerrainGraph, options: TerrainOptions) {
  const appliedParamsRef = useRef<{
    graph: TerrainGraph;
    values: Map<string, unknown>;
  } | null>(null);
  const {
    rootSize: nextRootSize,
    origin: nextOrigin,
    maxLevel: nextMaxLevel,
    maxNodes: nextMaxNodes,
    innerTileSegments: nextInnerTileSegments,
    skirtScale: nextSkirtScale,
    elevationScale: nextElevationScale,
    radius: nextRadius,
    elevation,
    topology: nextTopology,
    terrainFieldFilter: nextTerrainFieldFilter,
    texture: nextTexture,
    textureSet: nextTextureSet,
    textureRender: nextTextureRender,
    textureReadback: nextTextureReadback,
  } = options;

  useLayoutEffect(() => {
    let applied = appliedParamsRef.current;
    if (applied?.graph !== graph) {
      applied = { graph, values: new Map() };
      appliedParamsRef.current = applied;
    }
    const appliedValues = applied.values;

    resetOrSet(
      graph,
      appliedValues,
      rootSize,
      nextRootSize,
      () => nextRootSize as number,
    );
    resetOrSet(graph, appliedValues, origin, nextOrigin, () => ({
      x: nextOrigin?.x ?? 0,
      y: nextOrigin?.y ?? 0,
      z: nextOrigin?.z ?? 0,
    }));
    resetOrSet(
      graph,
      appliedValues,
      maxLevel,
      nextMaxLevel,
      () => nextMaxLevel as number,
    );
    resetOrSet(
      graph,
      appliedValues,
      maxNodes,
      nextMaxNodes,
      () => nextMaxNodes as number,
    );
    resetOrSet(
      graph,
      appliedValues,
      innerTileSegments,
      nextInnerTileSegments,
      () => nextInnerTileSegments as number,
    );
    resetOrSet(
      graph,
      appliedValues,
      skirtScale,
      nextSkirtScale,
      () => nextSkirtScale as number,
    );
    resetOrSet(
      graph,
      appliedValues,
      elevationScale,
      nextElevationScale,
      () => nextElevationScale as number,
    );
    resetOrSet(
      graph,
      appliedValues,
      radius,
      nextRadius,
      () => nextRadius as number,
    );
    resetOrSet(
      graph,
      appliedValues,
      topology,
      nextTopology,
      () => nextTopology as Exclude<TerrainOptions["topology"], undefined>,
    );
    resetOrSet(
      graph,
      appliedValues,
      terrainFieldFilter,
      nextTerrainFieldFilter,
      () => nextTerrainFieldFilter as "nearest" | "linear",
    );
    resetOrSet(graph, appliedValues, textureFn, nextTexture, () => nextTexture ?? null);
    resetOrSet(graph, appliedValues, textureSet, nextTextureSet, () => nextTextureSet ?? null);
    resetOrSet(graph, appliedValues, textureRender, nextTextureRender, () => nextTextureRender ?? {});
    resetOrSet(graph, appliedValues, textureReadback, nextTextureReadback, () => nextTextureReadback ?? false);

    resetOrSet(
      graph,
      appliedValues,
      elevationFn,
      elevation,
      () => elevation as Exclude<TerrainOptions["elevation"], undefined>,
    );
  }, [
    graph,
    nextRootSize,
    nextOrigin,
    nextMaxLevel,
    nextMaxNodes,
    nextInnerTileSegments,
    nextSkirtScale,
    nextElevationScale,
    nextRadius,
    elevation,
    nextTopology,
    nextTerrainFieldFilter,
    nextTexture,
    nextTextureSet,
    nextTextureRender,
    nextTextureReadback,
  ]);
}
