import type {
    ElevationRangeOut,
    LeafSet,
    TerrainResidencyParams,
    TileBounds,
    TileId,
    Topology,
} from './types';
import type { TileVisibilityState } from './visibility';

export const TileResidencyStateKind = {
    NotResident: 0,
    Visible: 1,
    Anchor: 2,
} as const;

export type TileResidencyStateKind =
    (typeof TileResidencyStateKind)[keyof typeof TileResidencyStateKind];

export type TileResidencyTelemetry = {
    candidateCount: number;
    visibleResidentCount: number;
    anchorResidentCount: number;
    residentCount: number;
    anchorCount: number;
    residentRatio: number;
};

export type TileResidencyState = {
    residentCandidateIndices: Uint32Array;
    residencyState: Uint8Array;
    telemetry: TileResidencyTelemetry;
};

export type TileResidencyOptions = {
    leaves: LeafSet;
    visibility: TileVisibilityState;
    topology: Topology;
    cameraOrigin: { x: number; y: number; z: number };
    residency?: TerrainResidencyParams;
    elevationRangeForTile?: (tile: TileId, out: ElevationRangeOut) => boolean;
};

const EMPTY_TELEMETRY: TileResidencyTelemetry = {
    candidateCount: 0,
    visibleResidentCount: 0,
    anchorResidentCount: 0,
    residentCount: 0,
    anchorCount: 0,
    residentRatio: 0,
};

function ensureResidencyState(prev: TileResidencyState | undefined, capacity: number) {
    if (
        prev &&
        prev.residentCandidateIndices.length >= capacity &&
        prev.residencyState.length >= capacity
    ) {
        return prev;
    }

    return {
        residentCandidateIndices: new Uint32Array(capacity),
        residencyState: new Uint8Array(capacity),
        telemetry: { ...EMPTY_TELEMETRY },
    };
}

function boundsIntersectsAnchor(
    cameraOrigin: { x: number; y: number; z: number },
    bounds: TileBounds,
    anchor: NonNullable<TerrainResidencyParams['anchors']>[number]
) {
    const radius = Math.max(0, anchor.radius) + bounds.r;
    const dx = cameraOrigin.x + bounds.cx - anchor.position.x;
    const dy = cameraOrigin.y + bounds.cy - anchor.position.y;
    const dz = cameraOrigin.z + bounds.cz - anchor.position.z;
    return dx * dx + dy * dy + dz * dz <= radius * radius;
}

function cachedBoundsIntersectsAnchor(
    cameraOrigin: { x: number; y: number; z: number },
    cx: number,
    cy: number,
    cz: number,
    r: number,
    anchor: NonNullable<TerrainResidencyParams['anchors']>[number]
) {
    const radius = Math.max(0, anchor.radius) + r;
    const dx = cameraOrigin.x + cx - anchor.position.x;
    const dy = cameraOrigin.y + cy - anchor.position.y;
    const dz = cameraOrigin.z + cz - anchor.position.z;
    return dx * dx + dy * dy + dz * dz <= radius * radius;
}

export function computeTileResidency(
    options: TileResidencyOptions,
    prev?: TileResidencyState
): TileResidencyState {
    const { leaves, visibility, topology, cameraOrigin } = options;
    const candidateCount = leaves.count;
    const state = ensureResidencyState(prev, leaves.capacity);
    const telemetry = state.telemetry;
    const anchors = options.residency?.anchors ?? [];
    const tile: TileId = { space: 0, level: 0, x: 0, y: 0 };
    const bounds: TileBounds = { cx: 0, cy: 0, cz: 0, r: 0 };
    const elevationRange: ElevationRangeOut = { min: 0, max: 0 };
    const cachedBoundsAvailable =
        (visibility.boundsCenterX?.length ?? 0) >= candidateCount &&
        (visibility.boundsCenterY?.length ?? 0) >= candidateCount &&
        (visibility.boundsCenterZ?.length ?? 0) >= candidateCount &&
        (visibility.boundsRadius?.length ?? 0) >= candidateCount;

    telemetry.candidateCount = candidateCount;
    telemetry.visibleResidentCount = 0;
    telemetry.anchorResidentCount = 0;
    telemetry.residentCount = 0;
    telemetry.anchorCount = anchors.length;
    telemetry.residentRatio = 0;
    state.residencyState.fill(TileResidencyStateKind.NotResident, 0, candidateCount);

    const visibleCount = Math.min(
        visibility.telemetry.visibleCount,
        visibility.visibleCandidateIndices.length
    );
    for (let visibleIndex = 0; visibleIndex < visibleCount; visibleIndex += 1) {
        const leafIndex = visibility.visibleCandidateIndices[visibleIndex] ?? 0;
        if (leafIndex >= candidateCount) continue;
        state.residencyState[leafIndex] = TileResidencyStateKind.Visible;
        state.residentCandidateIndices[telemetry.residentCount] = leafIndex;
        telemetry.residentCount += 1;
        telemetry.visibleResidentCount += 1;
    }

    if (anchors.length > 0) {
        for (let i = 0; i < candidateCount; i += 1) {
            if (state.residencyState[i] !== TileResidencyStateKind.NotResident) {
                continue;
            }

            if (cachedBoundsAvailable) {
                const cx = visibility.boundsCenterX![i] ?? 0;
                const cy = visibility.boundsCenterY![i] ?? 0;
                const cz = visibility.boundsCenterZ![i] ?? 0;
                const r = visibility.boundsRadius![i] ?? 0;
                for (const anchor of anchors) {
                    if (!cachedBoundsIntersectsAnchor(cameraOrigin, cx, cy, cz, r, anchor)) {
                        continue;
                    }
                    state.residencyState[i] = TileResidencyStateKind.Anchor;
                    state.residentCandidateIndices[telemetry.residentCount] = i;
                    telemetry.residentCount += 1;
                    telemetry.anchorResidentCount += 1;
                    break;
                }
            } else {
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
                    hasElevationRange ? elevationRange : undefined
                );

                for (const anchor of anchors) {
                    if (!boundsIntersectsAnchor(cameraOrigin, bounds, anchor)) continue;
                    state.residencyState[i] = TileResidencyStateKind.Anchor;
                    state.residentCandidateIndices[telemetry.residentCount] = i;
                    telemetry.residentCount += 1;
                    telemetry.anchorResidentCount += 1;
                    break;
                }
            }
        }
    }

    telemetry.residentRatio = candidateCount > 0 ? telemetry.residentCount / candidateCount : 0;

    return state;
}
