import { U32_EMPTY, type TileId } from './types';

function nextPow2(n: number): number {
    let x = 1;
    while (x < n) x <<= 1;
    return x;
}

function mix32(x: number): number {
    // 32-bit mix (xorshift + multiplication). Must stay in uint32.
    x >>>= 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
}

function hashKey(space: number, level: number, x: number, y: number): number {
    // Combine fields into a single uint32 hash seed, then mix.
    // Keep each piece within uint32.
    const h = (space & 0xff) ^ ((level & 0xff) << 8) ^ (mix32(x) >>> 0) ^ (mix32(y) >>> 0);
    return mix32(h);
}

export type SpatialIndex = {
    size: number;
    mask: number;

    stampGen: number;
    stamp: Uint16Array;

    keysSpace: Uint8Array;
    keysLevel: Uint8Array;
    keysX: Uint32Array;
    keysY: Uint32Array;

    values: Uint32Array;
};

export function createSpatialIndex(maxEntries: number): SpatialIndex {
    // keep load factor <= 0.5
    const size = nextPow2(Math.max(2, maxEntries * 2));
    return {
        size,
        mask: size - 1,
        stampGen: 1,
        stamp: new Uint16Array(size),
        keysSpace: new Uint8Array(size),
        keysLevel: new Uint8Array(size),
        keysX: new Uint32Array(size),
        keysY: new Uint32Array(size),
        values: new Uint32Array(size),
    };
}

export function resetSpatialIndex(index: SpatialIndex): void {
    index.stampGen = (index.stampGen + 1) & 0xffff;
    if (index.stampGen === 0) {
        // Extremely rare wrap: clear stamps once every 65535 resets.
        index.stamp.fill(0);
        index.stampGen = 1;
    }
}

export function insertSpatialIndexRaw(
    index: SpatialIndex,
    space: number,
    level: number,
    x: number,
    y: number,
    value: number
): void {
    const s = space & 0xff;
    const l = level & 0xff;
    const xx = x >>> 0;
    const yy = y >>> 0;

    let slot = hashKey(s, l, xx, yy) & index.mask;

    for (let probes = 0; probes < index.size; probes++) {
        if (index.stamp[slot] !== index.stampGen) {
            index.stamp[slot] = index.stampGen;
            index.keysSpace[slot] = s;
            index.keysLevel[slot] = l;
            index.keysX[slot] = xx;
            index.keysY[slot] = yy;
            index.values[slot] = value >>> 0;
            return;
        }

        if (
            index.keysSpace[slot] === s &&
            index.keysLevel[slot] === l &&
            index.keysX[slot] === xx &&
            index.keysY[slot] === yy
        ) {
            index.values[slot] = value >>> 0;
            return;
        }

        slot = (slot + 1) & index.mask;
    }

    // Table is full for this generation.
    throw new Error('SpatialIndex is full (no empty slot found).');
}

export function insertSpatialIndex(index: SpatialIndex, tile: TileId, value: number): void {
    insertSpatialIndexRaw(index, tile.space, tile.level, tile.x, tile.y, value);
}

export function lookupSpatialIndexRaw(
    index: SpatialIndex,
    space: number,
    level: number,
    x: number,
    y: number
): number {
    const s = space & 0xff;
    const l = level & 0xff;
    const xx = x >>> 0;
    const yy = y >>> 0;

    let slot = hashKey(s, l, xx, yy) & index.mask;

    for (let probes = 0; probes < index.size; probes++) {
        if (index.stamp[slot] !== index.stampGen) return U32_EMPTY;

        if (
            index.keysSpace[slot] === s &&
            index.keysLevel[slot] === l &&
            index.keysX[slot] === xx &&
            index.keysY[slot] === yy
        ) {
            return index.values[slot];
        }

        slot = (slot + 1) & index.mask;
    }

    // Table is full and the key wasn't found.
    return U32_EMPTY;
}

export function lookupSpatialIndex(index: SpatialIndex, tile: TileId): number {
    return lookupSpatialIndexRaw(index, tile.space, tile.level, tile.x, tile.y);
}
