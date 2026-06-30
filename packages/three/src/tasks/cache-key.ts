import type { Topology } from "../quadtree";

export function createTerrainQueryShapeKey(
  topology: Topology,
  maxNodes: number,
  innerTileSegments: number,
  maxLevel: number,
): string {
  return `${maxNodes}:${innerTileSegments}:${maxLevel}:${topology.cacheKey}`;
}

export function createTileSlotShapeKey(topology: Topology, maxNodes: number): string {
  return `${topology.cacheKey}:${topology.spaceCount}:${maxNodes}`;
}
