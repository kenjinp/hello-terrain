import { balance2to1 } from "./balance2to1";
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
  return balance2to1(state, topology, params, leaves);
}
