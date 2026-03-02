import { balance2to1 } from "./balance2to1";
import { refineLeaves } from "./refine";
import { beginUpdate, type QuadtreeState } from "./state";
import { type LeafSet, type Surface, type UpdateParams } from "./types";

/**
 * Update the quadtree for the given surface + camera parameters.
 *
 * Produces a LeafSet of TileIds (SoA typed arrays).
 */
export function update(
  state: QuadtreeState,
  surface: Surface,
  params: UpdateParams,
  outLeaves?: LeafSet,
): LeafSet {
  const origY = params.cameraOrigin.y;
  params.cameraOrigin.y -= params.elevationAtCameraXZ ?? 0;

  beginUpdate(state, surface, params);
  const leaves = refineLeaves(state, surface, params, outLeaves);
  const result = balance2to1(state, surface, params, leaves);

  params.cameraOrigin.y = origY;
  return result;
}
