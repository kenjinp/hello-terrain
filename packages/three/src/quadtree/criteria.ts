import { type TileBounds, type UpdateParams } from "./types";

export function shouldSplit(bounds: TileBounds, level: number, maxLevel: number, params: UpdateParams): boolean {
  if (level >= maxLevel) return false;

  const cx = bounds.cx;
  const cy = bounds.cy;
  const cz = bounds.cz;
  const distSq = cx * cx + cy * cy + cz * cz;

  // Degenerate case: camera is inside (or extremely near) the bounds center.
  const safeDistSq = distSq > 1e-12 ? distSq : 1e-12;

  if (params.mode === "screen") {
    // Compare squared pixel radius without sqrt:
    // pixelRadius^2 = (r^2 * proj^2) / distSq
    // split if pixelRadius^2 > target^2
    const proj = params.projectionFactor;
    const target = params.targetPixels;
    // Guard invalid inputs: a non-positive target would make splitting
    // unconditional (right = 0), and a non-positive proj is meaningless.
    // Treat either as "don't split" so refinement stays stable.
    if (proj <= 0 || target <= 0) return false;
    const left = bounds.r * bounds.r * proj * proj;
    const right = safeDistSq * target * target;
    return left > right;
  }

  // distance mode
  const f = params.distanceFactor ?? 2;
  const threshold = bounds.r * f;
  return safeDistSq < threshold * threshold;
}

