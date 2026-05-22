import { float, int, uniform } from "three/tsl";
import { Matrix4, Vector3, Vector4 } from "three/webgpu";
import type {
  TerrainCullingUniformsContext,
  TerrainCullingUniformsParams,
  TerrainUniformsContext,
  TerrainUniformsParams,
} from "../types";

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

  return {
    uRootOrigin,
    uRootSize,
    uInnerTileSegments,
    uSkirtScale,
    uElevationScale,
  };
}

export function createTerrainCullingUniforms(
  params: TerrainCullingUniformsParams,
): TerrainCullingUniformsContext {
  const sanitizedId = params.instanceId?.replace(/-/g, "_");
  const suffix = sanitizedId ? `_${sanitizedId}` : "";
  const uCameraProjectionMatrix = uniform(
    params.cameraProjectionMatrix.clone(),
  ).setName(`uCameraProjectionMatrix${suffix}`);
  const uCameraProjectionViewMatrix = uniform(
    params.cameraProjectionViewMatrix.clone(),
  ).setName(`uCameraProjectionViewMatrix${suffix}`);
  const uCameraViewMatrix = uniform(params.cameraViewMatrix.clone()).setName(
    `uCameraViewMatrix${suffix}`,
  );
  const uFrustumPlanes = [
    uniform(params.frustumPlanes[0]?.clone() ?? new Vector4()).setName(
      `uFrustumPlane0${suffix}`,
    ),
    uniform(params.frustumPlanes[1]?.clone() ?? new Vector4()).setName(
      `uFrustumPlane1${suffix}`,
    ),
    uniform(params.frustumPlanes[2]?.clone() ?? new Vector4()).setName(
      `uFrustumPlane2${suffix}`,
    ),
    uniform(params.frustumPlanes[3]?.clone() ?? new Vector4()).setName(
      `uFrustumPlane3${suffix}`,
    ),
    uniform(params.frustumPlanes[4]?.clone() ?? new Vector4()).setName(
      `uFrustumPlane4${suffix}`,
    ),
    uniform(params.frustumPlanes[5]?.clone() ?? new Vector4()).setName(
      `uFrustumPlane5${suffix}`,
    ),
  ] as const;

  return {
    uCameraProjectionMatrix,
    uCameraProjectionViewMatrix,
    uCameraViewMatrix,
    uFrustumPlanes,
  };
}
