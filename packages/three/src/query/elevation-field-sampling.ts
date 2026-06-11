/**
 * CPU sampling over a snapshot elevation-field buffer laid out as
 * `maxNodes × (edgeVertexCount × edgeVertexCount)` raw heights.
 *
 * Plain-number math only (no three.js, no TSL); callers build vectors at the
 * consumer-facing boundary.
 */

export interface ElevationGridShape {
  edgeVertexCount: number;
  verticesPerNode: number;
}

export function readHeight(
  elevation: Float32Array,
  shape: ElevationGridShape,
  leafIndex: number,
  ix: number,
  iy: number,
): number {
  const base = leafIndex * shape.verticesPerNode;
  return elevation[base + iy * shape.edgeVertexCount + ix] ?? 0;
}

/** Bilinear height at fractional grid coords, clamped to the grid. */
export function sampleGridBilinear(
  elevation: Float32Array,
  shape: ElevationGridShape,
  leafIndex: number,
  gx: number,
  gy: number,
): number {
  const max = shape.edgeVertexCount - 1;
  const x = Math.max(0, Math.min(max, gx));
  const y = Math.max(0, Math.min(max, gy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(max, x0 + 1);
  const y1 = Math.min(max, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const h00 = readHeight(elevation, shape, leafIndex, x0, y0);
  const h10 = readHeight(elevation, shape, leafIndex, x1, y0);
  const h01 = readHeight(elevation, shape, leafIndex, x0, y1);
  const h11 = readHeight(elevation, shape, leafIndex, x1, y1);
  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * ty;
}

export interface ElevationGradient {
  dhdu: number;
  dhdv: number;
}

/**
 * Central-difference elevation gradient (scaled to world units) at fractional
 * grid coords. Shared by the flat and cube-sphere normal reconstructions;
 * `out` is caller-owned scratch to keep hot paths allocation-free.
 *
 * Mirrors: the TSL `createNormalFromElevationField` in
 * `tasks/terrain-field.task.ts`.
 */
export function elevationGradientAt(
  elevation: Float32Array,
  shape: ElevationGridShape,
  leafIndex: number,
  gx: number,
  gy: number,
  stepWorld: number,
  elevationScale: number,
  out: ElevationGradient,
): ElevationGradient {
  const hLeft = sampleGridBilinear(elevation, shape, leafIndex, gx - 1, gy);
  const hRight = sampleGridBilinear(elevation, shape, leafIndex, gx + 1, gy);
  const hUp = sampleGridBilinear(elevation, shape, leafIndex, gx, gy - 1);
  const hDown = sampleGridBilinear(elevation, shape, leafIndex, gx, gy + 1);
  const inv2Step = 0.5 / stepWorld;
  out.dhdu = (hRight - hLeft) * elevationScale * inv2Step;
  out.dhdv = (hDown - hUp) * elevationScale * inv2Step;
  return out;
}
