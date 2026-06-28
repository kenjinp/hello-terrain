import {
  writeViewProjectionMatrix,
  type ViewProjectionMatrix,
} from "@hello-terrain/three";
import type { Camera } from "three";
import type { TerrainVector3Like } from "./types";

export const VIEW_PROJECTION_EPSILON = 1e-8;

export function didCameraOriginMove(
  lastOrigin: TerrainVector3Like | null,
  nextOrigin: TerrainVector3Like,
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
  if (!lastMatrix || lastMatrix.length < 16 || nextMatrix.length < 16) return true;
  for (let i = 0; i < 16; i += 1) {
    if (Math.abs((lastMatrix[i] ?? 0) - (nextMatrix[i] ?? 0)) > epsilon) {
      return true;
    }
  }
  return false;
}

export function copyMatrix16(target: Float64Array, source: ArrayLike<number>): void {
  for (let i = 0; i < 16; i += 1) target[i] = source[i] ?? 0;
}

export function writeCameraViewProjectionMatrix(
  camera: Camera,
  out: ViewProjectionMatrix,
): ViewProjectionMatrix {
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return writeViewProjectionMatrix(
    out,
    camera.projectionMatrix.elements,
    camera.matrixWorldInverse.elements,
  );
}
