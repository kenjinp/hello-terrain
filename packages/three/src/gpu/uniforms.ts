import { float, int, uniform } from "three/tsl";
import { Vector3 } from "three/webgpu";
import type { TerrainUniformsContext, TerrainUniformsParams } from "../types";

export function createTerrainUniforms(params: TerrainUniformsParams): TerrainUniformsContext {
  const sanitizedId = params.instanceId?.replace(/-/g, "_");
  const suffix = sanitizedId ? `_${sanitizedId}` : "";

  const uRootOrigin = uniform(
    new Vector3(params.rootOrigin.x, params.rootOrigin.y, params.rootOrigin.z),
  ).setName(`uRootOrigin${suffix}`);
  const uRootSize = uniform(float(params.rootSize)).setName(`uRootSize${suffix}`);
  const uInnerTileSegments = uniform(int(params.innerTileSegments)).setName(
    `uInnerTileSegments${suffix}`,
  );
  const uSkirtScale = uniform(float(params.skirtScale)).setName(`uSkirtScale${suffix}`);
  const uElevationScale = uniform(float(params.elevationScale)).setName(`uElevationScale${suffix}`);
  const uRadius = uniform(float(params.radius)).setName(`uRadius${suffix}`);

  return {
    uRootOrigin,
    uRootSize,
    uInnerTileSegments,
    uSkirtScale,
    uElevationScale,
    uRadius,
  };
}
