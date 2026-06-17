import type { SpatialIndex } from "../quadtree/spatialIndex";

function nextPow2(n: number): number {
  let x = 1;
  while (x < n) x <<= 1;
  return x;
}

function mix32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function hashKey(space: number, level: number, x: number, y: number): number {
  const h =
    (space & 0xff) ^
    ((level & 0xff) << 8) ^
    (mix32(x) >>> 0) ^
    (mix32(y) >>> 0);
  return mix32(h);
}

export type TileElevationPyramid = {
  size: number;
  mask: number;
  stampGen: number;
  stamp: Uint16Array;
  keysSpace: Uint8Array;
  keysLevel: Uint8Array;
  keysX: Uint32Array;
  keysY: Uint32Array;
  mins: Float32Array;
  maxs: Float32Array;
};

export function createTileElevationPyramid(maxNodes: number, maxLevel: number): TileElevationPyramid {
  const size = nextPow2(Math.max(2, maxNodes * (maxLevel + 1) * 2));
  return {
    size,
    mask: size - 1,
    stampGen: 1,
    stamp: new Uint16Array(size),
    keysSpace: new Uint8Array(size),
    keysLevel: new Uint8Array(size),
    keysX: new Uint32Array(size),
    keysY: new Uint32Array(size),
    mins: new Float32Array(size),
    maxs: new Float32Array(size),
  };
}

function beginPyramidGeneration(pyramid: TileElevationPyramid): void {
  pyramid.stampGen = (pyramid.stampGen + 1) & 0xffff;
  if (pyramid.stampGen === 0) {
    pyramid.stamp.fill(0);
    pyramid.stampGen = 1;
  }
}

function mergeRange(
  pyramid: TileElevationPyramid,
  space: number,
  level: number,
  x: number,
  y: number,
  min: number,
  max: number,
): void {
  const s = space & 0xff;
  const l = level & 0xff;
  const xx = x >>> 0;
  const yy = y >>> 0;

  let slot = hashKey(s, l, xx, yy) & pyramid.mask;

  for (let probes = 0; probes < pyramid.size; probes++) {
    if (pyramid.stamp[slot] !== pyramid.stampGen) {
      pyramid.stamp[slot] = pyramid.stampGen;
      pyramid.keysSpace[slot] = s;
      pyramid.keysLevel[slot] = l;
      pyramid.keysX[slot] = xx;
      pyramid.keysY[slot] = yy;
      pyramid.mins[slot] = min;
      pyramid.maxs[slot] = max;
      return;
    }

    if (
      pyramid.keysSpace[slot] === s &&
      pyramid.keysLevel[slot] === l &&
      pyramid.keysX[slot] === xx &&
      pyramid.keysY[slot] === yy
    ) {
      if (min < pyramid.mins[slot]) pyramid.mins[slot] = min;
      if (max > pyramid.maxs[slot]) pyramid.maxs[slot] = max;
      return;
    }

    slot = (slot + 1) & pyramid.mask;
  }

  throw new Error("TileElevationPyramid is full (no empty slot found).");
}

/**
 * Build a conservative elevation pyramid from leaf min/max readback data.
 * Each ancestor tile inherits the min/max of all descendant leaves beneath it.
 */
export function buildTileElevationPyramid(
  pyramid: TileElevationPyramid,
  index: SpatialIndex,
  tileBounds: Float32Array<ArrayBuffer>,
  leafCount: number,
): void {
  beginPyramidGeneration(pyramid);

  const stampGen = index.stampGen;
  for (let slot = 0; slot < index.size; slot++) {
    if (index.stamp[slot] !== stampGen) continue;

    const leafIndex = index.values[slot]!;
    if (leafIndex >= leafCount) continue;

    const space = index.keysSpace[slot]!;
    const level = index.keysLevel[slot]!;
    const x = index.keysX[slot]!;
    const y = index.keysY[slot]!;
    const rawMin = tileBounds[leafIndex * 2]!;
    const rawMax = tileBounds[leafIndex * 2 + 1]!;

    for (let ancestorLevel = level; ancestorLevel >= 0; ancestorLevel--) {
      const shift = level - ancestorLevel;
      mergeRange(
        pyramid,
        space,
        ancestorLevel,
        x >>> shift,
        y >>> shift,
        rawMin,
        rawMax,
      );
    }
  }
}

export function lookupTileElevationRange(
  pyramid: TileElevationPyramid,
  space: number,
  level: number,
  x: number,
  y: number,
  out: { min: number; max: number },
): boolean {
  const s = space & 0xff;
  const l = level & 0xff;
  const xx = x >>> 0;
  const yy = y >>> 0;

  let slot = hashKey(s, l, xx, yy) & pyramid.mask;

  for (let probes = 0; probes < pyramid.size; probes++) {
    if (pyramid.stamp[slot] !== pyramid.stampGen) return false;

    if (
      pyramid.keysSpace[slot] === s &&
      pyramid.keysLevel[slot] === l &&
      pyramid.keysX[slot] === xx &&
      pyramid.keysY[slot] === yy
    ) {
      out.min = pyramid.mins[slot]!;
      out.max = pyramid.maxs[slot]!;
      return true;
    }

    slot = (slot + 1) & pyramid.mask;
  }

  return false;
}
