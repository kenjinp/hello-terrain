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
  const cam = params.cameraOrigin;
  const elevation = params.elevationAtCameraXZ ?? 0;

  // Offset the camera toward the terrain surface so LOD distance is measured
  // from the surface rather than the datum. The projection knows its own
  // up-direction (e.g. +Y for flat, radial for a sphere, tube-outward for a
  // torus), so we delegate rather than branch on a projection kind.
  const origX = cam.x;
  const origY = cam.y;
  const origZ = cam.z;
  topology.projection.cpu.cameraSurfaceOffset(cam, elevation);

  beginUpdate(state, topology, params);
  const leaves = refineLeaves(state, topology, params, outLeaves);
  const result = balance2to1(state, topology, params, leaves);

  cam.x = origX;
  cam.y = origY;
  cam.z = origZ;
  return result;
}
