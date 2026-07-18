import type { TileBounds } from './types';

/**
 * Fit a conservative, camera-relative bounding sphere to a set of world-space
 * sample points (a tile's displaced corners/grid at its min/max elevation).
 *
 * The center is the points' centroid and the radius is the max distance from
 * that centroid to any point. Every topology shares this so a tile's bounds
 * always reflect the real displaced surface span — never the absolute height
 * above the datum. Camera-relative output keeps Earth-scale worlds numerically
 * stable. Allocation-free: the caller owns the `px`/`py`/`pz` scratch.
 */
export function boundingSphereFromPoints(
    px: Float64Array,
    py: Float64Array,
    pz: Float64Array,
    count: number,
    cameraOrigin: { x: number; y: number; z: number },
    out: TileBounds
): void {
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (let i = 0; i < count; i++) {
        sumX += px[i]!;
        sumY += py[i]!;
        sumZ += pz[i]!;
    }

    const cX = sumX / count;
    const cY = sumY / count;
    const cZ = sumZ / count;

    let maxDistSq = 0;
    for (let i = 0; i < count; i++) {
        const dx = px[i]! - cX;
        const dy = py[i]! - cY;
        const dz = pz[i]! - cZ;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > maxDistSq) maxDistSq = dSq;
    }

    out.cx = cX - cameraOrigin.x;
    out.cy = cY - cameraOrigin.y;
    out.cz = cZ - cameraOrigin.z;
    out.r = Math.sqrt(maxDistSq);
}
