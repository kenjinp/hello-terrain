import type { Camera } from "three";
import type { ViewProjectionMatrix } from "../quadtree";
import { writeViewProjectionMatrix } from "./camera";

export const VIEW_PROJECTION_EPSILON = 1e-8;
export const DEFAULT_CAMERA_ORIGIN_HYSTERESIS = 0.05;

export type CameraView = {
  cameraOrigin: { x: number; y: number; z: number };
  viewProjectionMatrix: ViewProjectionMatrix;
};

export type CameraViewEqualsConfig = {
  originHysteresis?: number;
  viewProjectionEpsilon?: number;
};

export type Vector3Like = {
  x: number;
  y: number;
  z: number;
};

function ensureViewProjectionMatrix(view: CameraView): ViewProjectionMatrix {
  if (view.viewProjectionMatrix?.length === 16)
    return view.viewProjectionMatrix;
  view.viewProjectionMatrix = Array.from({ length: 16 }, () => 0);
  return view.viewProjectionMatrix;
}

export function createInitialCameraView(): CameraView {
  return {
    cameraOrigin: { x: 0, y: 0, z: 0 },
    viewProjectionMatrix: Array.from({ length: 16 }, () => 0),
  };
}

export function didCameraOriginMove(
  lastOrigin: Vector3Like | null,
  nextOrigin: Vector3Like,
  hysteresis: number,
): boolean {
  if (!lastOrigin) return true;
  const dx = lastOrigin.x - nextOrigin.x;
  const dy = lastOrigin.y - nextOrigin.y;
  const dz = lastOrigin.z - nextOrigin.z;
  return dx * dx + dy * dy + dz * dz >= hysteresis * hysteresis;
}

export function didViewProjectionMatrixChange(
  lastMatrix: ArrayLike<number> | null,
  nextMatrix: ArrayLike<number>,
  epsilon = VIEW_PROJECTION_EPSILON,
): boolean {
  if (!lastMatrix || lastMatrix.length < 16 || nextMatrix.length < 16)
    return true;
  for (let i = 0; i < 16; i += 1) {
    if (Math.abs((lastMatrix[i] ?? 0) - (nextMatrix[i] ?? 0)) > epsilon) {
      return true;
    }
  }
  return false;
}

export function createCameraViewEquals(config: CameraViewEqualsConfig = {}) {
  const originHysteresis =
    config.originHysteresis ?? DEFAULT_CAMERA_ORIGIN_HYSTERESIS;
  const viewProjectionEpsilon =
    config.viewProjectionEpsilon ?? VIEW_PROJECTION_EPSILON;
  const thresholdSq = originHysteresis * originHysteresis;

  return (prev: CameraView, next: CameraView): boolean => {
    const dx = prev.cameraOrigin.x - next.cameraOrigin.x;
    const dy = prev.cameraOrigin.y - next.cameraOrigin.y;
    const dz = prev.cameraOrigin.z - next.cameraOrigin.z;
    if (dx * dx + dy * dy + dz * dz >= thresholdSq) return false;

    const lastMatrix = prev.viewProjectionMatrix;
    const nextMatrix = next.viewProjectionMatrix;
    if (!lastMatrix || lastMatrix.length < 16 || nextMatrix.length < 16)
      return false;
    for (let i = 0; i < 16; i += 1) {
      if (
        Math.abs((lastMatrix[i] ?? 0) - (nextMatrix[i] ?? 0)) >
        viewProjectionEpsilon
      ) {
        return false;
      }
    }
    return true;
  };
}

export const cameraViewEquals = createCameraViewEquals();

export function readCameraView(
  camera: Camera,
  out: CameraView,
  cameraOrigin: Vector3Like = camera.position,
): CameraView {
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  out.cameraOrigin.x = cameraOrigin.x;
  out.cameraOrigin.y = cameraOrigin.y;
  out.cameraOrigin.z = cameraOrigin.z;

  writeViewProjectionMatrix(
    ensureViewProjectionMatrix(out),
    camera.projectionMatrix.elements,
    camera.matrixWorldInverse.elements,
  );

  return out;
}
