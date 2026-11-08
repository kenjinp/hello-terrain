import { buildLeafIndex } from "./leafIndex";
import { refineLeaves } from "./refine";
import { beginUpdate, type QuadtreeState } from "./state";
import { type LeafSet, type Topology, type UpdateParams } from "./types";

/**
 * Update the quadtree for the given topology + camera parameters.
 *
 * Produces a LeafSet of TileIds (SoA typed arrays).
 */
export function update(
  state: QuadtreeState,
  topology: Topology,
  params: UpdateParams,
  outLeaves?: LeafSet,
): LeafSet {
  beginUpdate(state, topology, params);
  const leaves = refineLeaves(state, topology, params, outLeaves);
  buildLeafIndex(leaves, state.leafIndex);
  return leaves;
}
