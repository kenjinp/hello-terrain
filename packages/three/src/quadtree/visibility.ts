import type {
  ElevationRangeOut,
  LeafSet,
  TileBounds,
  TileId,
  Topology,
  ViewProjectionMatrix,
} from "./types";

export const TileVisibilityStateKind = {
  Visible: 0,
  Guard: 1,
  FrustumCulled: 2,
  HorizonCulled: 3,
  Unculled: 4,
} as const;

export type TileVisibilityStateKind =
  (typeof TileVisibilityStateKind)[keyof typeof TileVisibilityStateKind];

export type TileVisibilityTelemetry = {
  candidateCount: number;
  visibleCount: number;
  guardCount: number;
  frustumCulledCount: number;
  horizonCulledCount: number;
  unculledCount: number;
  visibleRatio: number;
};

export type TileVisibilityState = {
  visibleCandidateIndices: Uint32Array;
  visibilityState: Uint8Array;
  telemetry: TileVisibilityTelemetry;
};

export type TileVisibilityOptions = {
  leaves: LeafSet;
  topology: Topology;
  cameraOrigin: { x: number; y: number; z: number };
  viewProjectionMatrix?: ViewProjectionMatrix;
  /**
   * Inflates analytic bounds before culling. Values above 1 trade culling
   * efficiency for extra conservatism near frustum edges and the horizon.
   */
  guardBandFactor?: number;
  elevationRangeForTile?: (tile: TileId, out: ElevationRangeOut) => boolean;
};

const DEFAULT_GUARD_BAND_FACTOR = 1.08;
const EMPTY_TELEMETRY: TileVisibilityTelemetry = {
  candidateCount: 0,
  visibleCount: 0,
  guardCount: 0,
  frustumCulledCount: 0,
  horizonCulledCount: 0,
  unculledCount: 0,
  visibleRatio: 0,
};

function ensureVisibilityState(prev: TileVisibilityState | undefined, capacity: number) {
  if (
    prev &&
    prev.visibleCandidateIndices.length >= capacity &&
    prev.visibilityState.length >= capacity
  ) {
    return prev;
  }

  return {
    visibleCandidateIndices: new Uint32Array(capacity),
    visibilityState: new Uint8Array(capacity),
    telemetry: { ...EMPTY_TELEMETRY },
  };
}

function writePlane(
  out: Float64Array,
  planeIndex: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const length = Math.hypot(x, y, z);
  if (length === 0) return false;
  const invLength = 1 / length;
  const offset = planeIndex * 4;
  out[offset] = x * invLength;
  out[offset + 1] = y * invLength;
  out[offset + 2] = z * invLength;
  out[offset + 3] = w * invLength;
  return true;
}

function extractFrustumPlanes(
  viewProjectionMatrix: ViewProjectionMatrix | undefined,
  out: Float64Array,
) {
  if (!viewProjectionMatrix || viewProjectionMatrix.length < 16) return false;
  const m = viewProjectionMatrix;

  return (
    writePlane(
      out,
      0,
      (m[3] ?? 0) - (m[0] ?? 0),
      (m[7] ?? 0) - (m[4] ?? 0),
      (m[11] ?? 0) - (m[8] ?? 0),
      (m[15] ?? 0) - (m[12] ?? 0),
    ) &&
    writePlane(
      out,
      1,
      (m[3] ?? 0) + (m[0] ?? 0),
      (m[7] ?? 0) + (m[4] ?? 0),
      (m[11] ?? 0) + (m[8] ?? 0),
      (m[15] ?? 0) + (m[12] ?? 0),
    ) &&
    writePlane(
      out,
      2,
      (m[3] ?? 0) + (m[1] ?? 0),
      (m[7] ?? 0) + (m[5] ?? 0),
      (m[11] ?? 0) + (m[9] ?? 0),
      (m[15] ?? 0) + (m[13] ?? 0),
    ) &&
    writePlane(
      out,
      3,
      (m[3] ?? 0) - (m[1] ?? 0),
      (m[7] ?? 0) - (m[5] ?? 0),
      (m[11] ?? 0) - (m[9] ?? 0),
      (m[15] ?? 0) - (m[13] ?? 0),
    ) &&
    writePlane(
      out,
      4,
      (m[3] ?? 0) + (m[2] ?? 0),
      (m[7] ?? 0) + (m[6] ?? 0),
      (m[11] ?? 0) + (m[10] ?? 0),
      (m[15] ?? 0) + (m[14] ?? 0),
    ) &&
    writePlane(
      out,
      5,
      (m[3] ?? 0) - (m[2] ?? 0),
      (m[7] ?? 0) - (m[6] ?? 0),
      (m[11] ?? 0) - (m[10] ?? 0),
      (m[15] ?? 0) - (m[14] ?? 0),
    )
  );
}

function intersectsFrustum(
  planes: Float64Array,
  cameraOrigin: { x: number; y: number; z: number },
  bounds: TileBounds,
  guardBandFactor: number,
) {
  const x = cameraOrigin.x + bounds.cx;
  const y = cameraOrigin.y + bounds.cy;
  const z = cameraOrigin.z + bounds.cz;
  const radius = bounds.r * guardBandFactor;

  for (let planeIndex = 0; planeIndex < 6; planeIndex += 1) {
    const offset = planeIndex * 4;
    const distance =
      (planes[offset] ?? 0) * x +
      (planes[offset + 1] ?? 0) * y +
      (planes[offset + 2] ?? 0) * z +
      (planes[offset + 3] ?? 0);
    if (distance < -radius) return false;
  }

  return true;
}

export function computeTileVisibility(
  options: TileVisibilityOptions,
  prev?: TileVisibilityState,
): TileVisibilityState {
  const { leaves, topology, cameraOrigin } = options;
  const candidateCount = leaves.count;
  const state = ensureVisibilityState(prev, leaves.capacity);
  const telemetry = state.telemetry;
  const bounds: TileBounds = { cx: 0, cy: 0, cz: 0, r: 0 };
  const tile: TileId = { space: 0, level: 0, x: 0, y: 0 };
  const elevationRange: ElevationRangeOut = { min: 0, max: 0 };
  const frustumPlanes = new Float64Array(24);
  const guardBandFactor = Math.max(
    1,
    options.guardBandFactor ?? DEFAULT_GUARD_BAND_FACTOR,
  );
  const projectionCpu = topology.projection.cpu;
  const canUseHorizon =
    typeof projectionCpu.isTileBehindHorizon === "function";
  const canUseFrustum = extractFrustumPlanes(
    options.viewProjectionMatrix,
    frustumPlanes,
  );

  telemetry.candidateCount = candidateCount;
  telemetry.visibleCount = 0;
  telemetry.guardCount = 0;
  telemetry.frustumCulledCount = 0;
  telemetry.horizonCulledCount = 0;
  telemetry.unculledCount = 0;
  telemetry.visibleRatio = 0;

  for (let i = 0; i < candidateCount; i += 1) {
    tile.space = leaves.space[i] ?? 0;
    tile.level = leaves.level[i] ?? 0;
    tile.x = leaves.x[i] ?? 0;
    tile.y = leaves.y[i] ?? 0;
    const hasElevationRange =
      options.elevationRangeForTile?.(tile, elevationRange) ?? false;

    topology.tileBounds(
      tile,
      cameraOrigin,
      bounds,
      hasElevationRange ? elevationRange : undefined,
    );

    if (
      canUseFrustum &&
      !intersectsFrustum(frustumPlanes, cameraOrigin, bounds, guardBandFactor)
    ) {
      state.visibilityState[i] = TileVisibilityStateKind.FrustumCulled;
      telemetry.frustumCulledCount += 1;
      continue;
    }

    if (
      projectionCpu.isTileBehindHorizon?.({
        cameraOrigin,
        bounds,
        guardBandFactor,
      })
    ) {
      state.visibilityState[i] = TileVisibilityStateKind.HorizonCulled;
      telemetry.horizonCulledCount += 1;
      continue;
    }

    state.visibleCandidateIndices[telemetry.visibleCount] = i;
    state.visibilityState[i] = canUseHorizon
      ? TileVisibilityStateKind.Visible
      : TileVisibilityStateKind.Unculled;
    telemetry.visibleCount += 1;
    if (!canUseHorizon) telemetry.unculledCount += 1;
  }

  telemetry.visibleRatio =
    candidateCount > 0 ? telemetry.visibleCount / candidateCount : 0;

  return state;
}
