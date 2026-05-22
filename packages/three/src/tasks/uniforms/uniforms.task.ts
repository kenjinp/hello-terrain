import { task } from "@hello-terrain/work";
import {
  createTerrainCullingUniforms,
  createTerrainUniforms,
} from "../../gpu/uniforms";
import {
  createFrustumPlaneTuple,
  extractFrustumPlanesFromMatrix,
} from "../../gpu/frustumPlanes";
import type {
  TerrainCullingUniformsParams,
  TerrainUniformsParams,
} from "../../types";
import { instanceIdTask } from "../instanceId.task";
import {
  cameraProjectionMatrix,
  cameraProjectionViewMatrix,
  cameraViewMatrix,
  elevationScale,
  innerTileSegments,
  origin,
  rootSize,
  skirtScale,
} from "../params";
import { Matrix4 } from "three/webgpu";

/**
 * Creates the terrain uniform nodes once. Downstream tasks capture
 * references to these nodes in shader graphs, so the same instances
 * must persist across runs.
 */
export const createUniformsTask = task((get, work) => {
  const uniformParams: TerrainUniformsParams = {
    rootOrigin: get(origin),
    rootSize: get(rootSize),
    innerTileSegments: get(innerTileSegments),
    skirtScale: get(skirtScale),
    elevationScale: get(elevationScale),
    instanceId: get(instanceIdTask),
  };
  return work(() => createTerrainUniforms(uniformParams));
})
  .displayName("createUniformsTask")
  .cache("once");

/**
 * Updates the terrain uniform values each run. Reads the persisted uniform
 * nodes from createUniformsTask and writes the latest param values.
 */
export const updateUniformsTask = task((get, work) => {
  const terrainUniformsContext = get(createUniformsTask);
  const rootSizeVal = get(rootSize);
  const rootOrigin = get(origin);
  const innerTileSegmentsVal = get(innerTileSegments);
  const skirtScaleVal = get(skirtScale);
  const elevationScaleVal = get(elevationScale);

  return work(() => {
    terrainUniformsContext.uRootSize.value = rootSizeVal;
    terrainUniformsContext.uRootOrigin.value.set(
      rootOrigin.x,
      rootOrigin.y,
      rootOrigin.z,
    );
    terrainUniformsContext.uInnerTileSegments.value = innerTileSegmentsVal;
    terrainUniformsContext.uSkirtScale.value = skirtScaleVal;
    terrainUniformsContext.uElevationScale.value = elevationScaleVal;

    return terrainUniformsContext;
  });
}).displayName("updateUniformsTask");

export const createCullingUniformsTask = task((get, work) => {
  const projectionViewMatrix = new Matrix4().fromArray(
    get(cameraProjectionViewMatrix),
  );
  const projectionMatrix = new Matrix4().fromArray(get(cameraProjectionMatrix));
  const viewMatrix = new Matrix4().fromArray(get(cameraViewMatrix));
  const frustumPlanes = extractFrustumPlanesFromMatrix(
    get(cameraProjectionViewMatrix),
    createFrustumPlaneTuple(),
  );
  const uniformParams: TerrainCullingUniformsParams = {
    cameraProjectionMatrix: projectionMatrix,
    cameraProjectionViewMatrix: projectionViewMatrix,
    cameraViewMatrix: viewMatrix,
    frustumPlanes,
    instanceId: get(instanceIdTask),
  };
  return work(() => createTerrainCullingUniforms(uniformParams));
})
  .displayName("createCullingUniformsTask")
  .cache("once");

export const updateCullingUniformsTask = task((get, work) => {
  const terrainUniformsContext = get(createCullingUniformsTask);
  const projection = get(cameraProjectionMatrix);
  const projectionView = get(cameraProjectionViewMatrix);
  const view = get(cameraViewMatrix);

  return work(() => {
    terrainUniformsContext.uCameraProjectionMatrix.value.fromArray(projection);
    terrainUniformsContext.uCameraProjectionViewMatrix.value.fromArray(
      projectionView,
    );
    terrainUniformsContext.uCameraViewMatrix.value.fromArray(view);

    const frustumPlanes = extractFrustumPlanesFromMatrix(projectionView);
    for (let i = 0; i < frustumPlanes.length; i += 1) {
      terrainUniformsContext.uFrustumPlanes[i]?.value.copy(frustumPlanes[i]);
    }

    return terrainUniformsContext;
  });
}).displayName("updateCullingUniformsTask");
