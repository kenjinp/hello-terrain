import { Vector4 } from "three/webgpu";

export type FrustumPlaneTuple = readonly [
  Vector4,
  Vector4,
  Vector4,
  Vector4,
  Vector4,
  Vector4,
];

function normalizePlane(plane: Vector4): Vector4 {
  const invLength = 1 / Math.hypot(plane.x, plane.y, plane.z, 1e-20);
  plane.multiplyScalar(invLength);
  return plane;
}

export function createFrustumPlaneTuple(): FrustumPlaneTuple {
  return [
    new Vector4(),
    new Vector4(),
    new Vector4(),
    new Vector4(),
    new Vector4(),
    new Vector4(),
  ];
}

export function extractFrustumPlanesFromMatrix(
  elements: ArrayLike<number>,
  out: FrustumPlaneTuple = createFrustumPlaneTuple(),
): FrustumPlaneTuple {
  const m00 = elements[0] ?? 0;
  const m01 = elements[1] ?? 0;
  const m02 = elements[2] ?? 0;
  const m03 = elements[3] ?? 0;
  const m10 = elements[4] ?? 0;
  const m11 = elements[5] ?? 0;
  const m12 = elements[6] ?? 0;
  const m13 = elements[7] ?? 0;
  const m20 = elements[8] ?? 0;
  const m21 = elements[9] ?? 0;
  const m22 = elements[10] ?? 0;
  const m23 = elements[11] ?? 0;
  const m30 = elements[12] ?? 0;
  const m31 = elements[13] ?? 0;
  const m32 = elements[14] ?? 0;
  const m33 = elements[15] ?? 0;

  out[0].set(m03 + m00, m13 + m10, m23 + m20, m33 + m30);
  out[1].set(m03 - m00, m13 - m10, m23 - m20, m33 - m30);
  out[2].set(m03 + m01, m13 + m11, m23 + m21, m33 + m31);
  out[3].set(m03 - m01, m13 - m11, m23 - m21, m33 - m31);
  out[4].set(m03 + m02, m13 + m12, m23 + m22, m33 + m32);
  out[5].set(m03 - m02, m13 - m12, m23 - m22, m33 - m32);

  for (const plane of out) normalizePlane(plane);
  return out;
}
