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
  const cam = params.cameraOrigin;
  const elevation = params.elevationAtCameraXZ ?? 0;

  // Offset the camera toward the terrain surface so LOD distance is measured
  // from the surface rather than the datum. On a cube sphere the surface
  // up-direction is radial, so move the camera inward along it; otherwise the
  // up-direction is +Y.
  const origX = cam.x;
  const origY = cam.y;
  const origZ = cam.z;
  if (surface.projection === "cubeSphere") {
    const center = surface.center ?? { x: 0, y: 0, z: 0 };
    const dx = cam.x - center.x;
    const dy = cam.y - center.y;
    const dz = cam.z - center.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-12) {
      const inv = elevation / len;
      cam.x -= dx * inv;
      cam.y -= dy * inv;
      cam.z -= dz * inv;
    }
  } else {
    cam.y -= elevation;
  }

  beginUpdate(state, surface, params);
  const leaves = refineLeaves(state, surface, params, outLeaves);
  const result = balance2to1(state, surface, params, leaves);

  cam.x = origX;
  cam.y = origY;
  cam.z = origZ;
  return result;
}
