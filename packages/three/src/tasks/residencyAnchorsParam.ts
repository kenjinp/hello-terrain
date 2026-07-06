import type { TerrainResidencyAnchor } from '../quadtree';

export const DEFAULT_RESIDENCY_HYSTERESIS = 0.05;

export type ResidencyAnchorsEqualsConfig = {
    hysteresis?: number;
};

export function createResidencyAnchorsEquals(config: ResidencyAnchorsEqualsConfig = {}) {
    const hysteresis = config.hysteresis ?? DEFAULT_RESIDENCY_HYSTERESIS;
    const thresholdSq = hysteresis * hysteresis;

    return (
        prev: readonly TerrainResidencyAnchor[],
        next: readonly TerrainResidencyAnchor[]
    ): boolean => {
        const prevCount = prev.length;
        const nextCount = next.length;
        if (prevCount !== nextCount) return false;

        for (let i = 0; i < nextCount; i += 1) {
            const a = prev[i];
            const b = next[i];
            if (!a || !b) return false;
            if (Math.abs(a.radius - b.radius) > hysteresis) return false;
            const dx = a.position.x - b.position.x;
            const dy = a.position.y - b.position.y;
            const dz = a.position.z - b.position.z;
            if (dx * dx + dy * dy + dz * dz > thresholdSq) return false;
        }
        return true;
    };
}

export const residencyAnchorsEquals = createResidencyAnchorsEquals();

export function cloneResidencyAnchors(
    anchors: readonly TerrainResidencyAnchor[] | undefined
): TerrainResidencyAnchor[] {
    if (!anchors || anchors.length === 0) return [];
    return anchors.map((anchor) => ({
        position: {
            x: anchor.position.x,
            y: anchor.position.y,
            z: anchor.position.z,
        },
        radius: anchor.radius,
    }));
}
