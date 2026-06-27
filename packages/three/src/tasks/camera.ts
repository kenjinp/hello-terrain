import type { Camera } from "three";
import type { UpdateParams, ViewProjectionMatrix } from "../quadtree";

type Vector3Like = {
  x: number;
  y: number;
  z: number;
};

function ensureViewProjectionMatrix(params: UpdateParams): ViewProjectionMatrix {
  if (params.viewProjectionMatrix?.length === 16) return params.viewProjectionMatrix;
  params.viewProjectionMatrix = Array.from({ length: 16 }, () => 0);
  return params.viewProjectionMatrix;
}

export function writeViewProjectionMatrix(
  out: ViewProjectionMatrix,
  projectionMatrix: ArrayLike<number>,
  viewMatrix: ArrayLike<number>,
): ViewProjectionMatrix {
  const a11 = projectionMatrix[0] ?? 0;
  const a12 = projectionMatrix[4] ?? 0;
  const a13 = projectionMatrix[8] ?? 0;
  const a14 = projectionMatrix[12] ?? 0;
  const a21 = projectionMatrix[1] ?? 0;
  const a22 = projectionMatrix[5] ?? 0;
  const a23 = projectionMatrix[9] ?? 0;
  const a24 = projectionMatrix[13] ?? 0;
  const a31 = projectionMatrix[2] ?? 0;
  const a32 = projectionMatrix[6] ?? 0;
  const a33 = projectionMatrix[10] ?? 0;
  const a34 = projectionMatrix[14] ?? 0;
  const a41 = projectionMatrix[3] ?? 0;
  const a42 = projectionMatrix[7] ?? 0;
  const a43 = projectionMatrix[11] ?? 0;
  const a44 = projectionMatrix[15] ?? 0;

  const b11 = viewMatrix[0] ?? 0;
  const b12 = viewMatrix[4] ?? 0;
  const b13 = viewMatrix[8] ?? 0;
  const b14 = viewMatrix[12] ?? 0;
  const b21 = viewMatrix[1] ?? 0;
  const b22 = viewMatrix[5] ?? 0;
  const b23 = viewMatrix[9] ?? 0;
  const b24 = viewMatrix[13] ?? 0;
  const b31 = viewMatrix[2] ?? 0;
  const b32 = viewMatrix[6] ?? 0;
  const b33 = viewMatrix[10] ?? 0;
  const b34 = viewMatrix[14] ?? 0;
  const b41 = viewMatrix[3] ?? 0;
  const b42 = viewMatrix[7] ?? 0;
  const b43 = viewMatrix[11] ?? 0;
  const b44 = viewMatrix[15] ?? 0;

  out[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  out[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  out[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  out[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

  out[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  out[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  out[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  out[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

  out[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  out[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  out[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  out[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

  out[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  out[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  out[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  out[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

  return out;
}

export function writeUpdateParamsFromCamera(
  params: UpdateParams,
  camera: Camera,
  cameraOrigin: Vector3Like = camera.position,
): UpdateParams {
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  params.cameraOrigin.x = cameraOrigin.x;
  params.cameraOrigin.y = cameraOrigin.y;
  params.cameraOrigin.z = cameraOrigin.z;

  writeViewProjectionMatrix(
    ensureViewProjectionMatrix(params),
    camera.projectionMatrix.elements,
    camera.matrixWorldInverse.elements,
  );

  return params;
}
