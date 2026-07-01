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

type CameraViewSnapshot = {
  originX: number;
  originY: number;
  originZ: number;
  matrix: Float64Array;
};

/**
 * Builds a change-detection comparator for the `cameraView` param.
 *
 * The per-frame ergonomic contract is "fill a reused scratch and push it every
 * frame" (allocation-free). But `graph.set()` keeps whatever object it is handed
 * as the baseline for the next comparison, so a plain field-by-field `equals`
 * would compare a mutated scratch against itself and report "unchanged" forever,
 * freezing the quadtree after the first frame.
 *
 * To stay allocation-free *and* correct, the comparator keeps its own snapshot
 * of the last accepted value. When the same object instance is pushed again
 * (`prev === next`, the reused-scratch case) it compares the live contents
 * against that snapshot instead of against itself. Snapshots are stored in a
 * `WeakMap` keyed by the pushed object's identity so distinct terrain instances
 * (each with their own scratch) never share change-detection state and nothing
 * leaks once a scratch is collected. When two independent objects are compared
 * (`prev !== next`, e.g. callers that hand over a fresh value) `prev` is already
 * a stable baseline, so a direct field comparison is used and no snapshot is
 * retained. Either way a single scratch allocates one snapshot for its lifetime,
 * never one per frame.
 */
export function createCameraViewEquals(config: CameraViewEqualsConfig = {}) {
  const originHysteresis =
    config.originHysteresis ?? DEFAULT_CAMERA_ORIGIN_HYSTERESIS;
  const viewProjectionEpsilon =
    config.viewProjectionEpsilon ?? VIEW_PROJECTION_EPSILON;
  const thresholdSq = originHysteresis * originHysteresis;
  const snapshots = new WeakMap<CameraView, CameraViewSnapshot>();

  const originClose = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): boolean => {
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    return dx * dx + dy * dy + dz * dz < thresholdSq;
  };

  const matrixClose = (a: ViewProjectionMatrix, b: ViewProjectionMatrix): boolean => {
    if (!a || !b || a.length < 16 || b.length < 16) return false;
    for (let i = 0; i < 16; i += 1) {
      if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > viewProjectionEpsilon) {
        return false;
      }
    }
    return true;
  };

  const writeSnapshot = (snapshot: CameraViewSnapshot, view: CameraView): void => {
    snapshot.originX = view.cameraOrigin.x;
    snapshot.originY = view.cameraOrigin.y;
    snapshot.originZ = view.cameraOrigin.z;
    const matrix = view.viewProjectionMatrix;
    for (let i = 0; i < 16; i += 1) snapshot.matrix[i] = matrix[i] ?? 0;
  };

  return (prev: CameraView, next: CameraView): boolean => {
    if (prev !== next) {
      // Independent objects: `prev` is a stable baseline, compare directly.
      return (
        originClose(
          prev.cameraOrigin.x,
          prev.cameraOrigin.y,
          prev.cameraOrigin.z,
          next.cameraOrigin.x,
          next.cameraOrigin.y,
          next.cameraOrigin.z,
        ) && matrixClose(prev.viewProjectionMatrix, next.viewProjectionMatrix)
      );
    }

    // Reused scratch: compare live contents against our retained snapshot.
    const snapshot = snapshots.get(next);
    if (!snapshot) {
      const created: CameraViewSnapshot = {
        originX: 0,
        originY: 0,
        originZ: 0,
        matrix: new Float64Array(16),
      };
      writeSnapshot(created, next);
      snapshots.set(next, created);
      return false;
    }

    const unchanged =
      originClose(
        snapshot.originX,
        snapshot.originY,
        snapshot.originZ,
        next.cameraOrigin.x,
        next.cameraOrigin.y,
        next.cameraOrigin.z,
      ) && matrixClose(snapshot.matrix, next.viewProjectionMatrix);

    if (unchanged) return true;

    writeSnapshot(snapshot, next);
    return false;
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
