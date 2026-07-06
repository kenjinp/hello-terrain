/**
 * Precision-safe heightmap sampling.
 *
 * # Why this exists (the decode-before-filter invariant)
 *
 * Hardware texture filtering must never touch encoded height data. Filtering
 * precision of unorm8 textures is implementation-defined: desktop GPUs return
 * filtered results with extra fractional bits, while Apple GPUs quantize the
 * filtered result to roughly the storage precision. Any packing scheme that
 * decodes *after* the hardware tap (e.g. 16-bit heights split across two
 * unorm8 channels) multiplies that quantization by the channel weight — a
 * 1/255 step in a filtered high byte becomes a ~1/256 step in decoded height,
 * i.e. meters-tall terracing on real elevation ranges.
 *
 * This module therefore:
 * - stores heights as `r32float` (a uint16 converts to f32 losslessly),
 * - reads texels with `textureLoad` (a samplerless fetch — the fixed-function
 *   filter unit is never involved, so `float32-filterable` is not required),
 * - reconstructs bilinear/bicubic surfaces in fp32 ALU ops, which are
 *   deterministic across GPU vendors,
 * - mirrors the exact same math on the CPU so physics/raycast consumers can
 *   agree with the rendered surface bit-for-bit (up to fp32 rounding).
 *
 * fp16 storage is NOT a substitute: an f16 mantissa quantizes to ~0.8 m at
 * 2000 m elevation, which still bands in derived normals.
 */
import {
    ClampToEdgeWrapping,
    DataTexture,
    FloatType,
    NearestFilter,
    NoColorSpace,
    RedFormat,
} from 'three';
import { float, ivec2, mix, textureLoad, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';

export interface CreateHeightmapFieldOptions {
    /** Raw 16-bit height samples, row-major, `width * height` entries. */
    data: Uint16Array;
    width: number;
    height: number;
    /** Elevation of sample value 0, in meters. */
    minMeters: number;
    /** Elevation of sample value 65535, in meters. */
    maxMeters: number;
    /**
     * Reverse row order at upload so `uv.y = 0` samples the *last* row of
     * `data` (matches THREE's `flipY` convention for image textures). The CPU
     * samplers see the same orientation as the GPU either way.
     */
    flipY?: boolean;
}

export interface HeightmapField {
    /** `r32float` texture of normalized heights. Do not change its filters. */
    texture: DataTexture;
    width: number;
    height: number;
    minMeters: number;
    maxMeters: number;
    rangeMeters: number;
    /** Normalized heights as uploaded (row-flipped when `flipY`). */
    normalized: Float32Array;

    /** Exact manual bilinear sample of normalized height at `uv` (TSL). */
    sampleNormalized(uv: Node): Node;
    /** Exact Catmull-Rom bicubic sample of normalized height at `uv` (TSL). */
    sampleNormalizedBicubic(uv: Node): Node;
    /** Bilinear elevation in meters at `uv` (TSL). */
    sampleMeters(uv: Node): Node;
    /** Bicubic elevation in meters at `uv` (TSL). */
    sampleMetersBicubic(uv: Node): Node;

    /** CPU mirror of {@link sampleNormalized}. */
    sampleNormalizedCpu(u: number, v: number): number;
    /** CPU mirror of {@link sampleNormalizedBicubic}. */
    sampleNormalizedBicubicCpu(u: number, v: number): number;
    /** CPU mirror of {@link sampleMeters}. */
    sampleMetersCpu(u: number, v: number): number;
    /** CPU mirror of {@link sampleMetersBicubic}. */
    sampleMetersBicubicCpu(u: number, v: number): number;

    dispose(): void;
}

/**
 * Catmull-Rom weights for a fractional offset `t` in [0, 1). Exposed for
 * tests; the TSL sampler inlines the same polynomials.
 */
export function catmullRomWeights(t: number): [number, number, number, number] {
    const t2 = t * t;
    const t3 = t2 * t;
    return [
        (-t3 + 2 * t2 - t) * 0.5,
        (3 * t3 - 5 * t2 + 2) * 0.5,
        (-3 * t3 + 4 * t2 + t) * 0.5,
        (t3 - t2) * 0.5,
    ];
}

/** Create a precision-safe heightmap field from raw 16-bit samples. */
export function createHeightmapField(options: CreateHeightmapFieldOptions): HeightmapField {
    const { data, width, height, minMeters, maxMeters, flipY = false } = options;
    if (data.length !== width * height) {
        throw new Error(
            `createHeightmapField: data length ${data.length} does not match ${width}x${height}`
        );
    }
    const rangeMeters = maxMeters - minMeters;

    // Normalize (and optionally row-flip) once on the CPU. u16 -> f32 is
    // lossless, and both the GPU texture and the CPU samplers read this array's
    // layout, so they cannot disagree about orientation.
    const normalized = new Float32Array(data.length);
    for (let row = 0; row < height; row += 1) {
        const srcRow = flipY ? height - 1 - row : row;
        const src = srcRow * width;
        const dst = row * width;
        for (let x = 0; x < width; x += 1) {
            normalized[dst + x] = data[src + x] / 65535;
        }
    }

    const texture = new DataTexture(normalized, width, height, RedFormat, FloatType);
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    // Nearest is deliberate: all reads go through textureLoad, and nothing may
    // ever bind this texture to a filtering sampler (see module docs).
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    texture.needsUpdate = true;

    const maxTexel = vec2(width - 1, height - 1);

    /** Samplerless fetch of one texel, with edge clamping, as a float node. */
    const load = (texelPos: any): any =>
        (textureLoad(texture, ivec2(texelPos.clamp(vec2(0, 0), maxTexel)) as any) as any).r;

    const sampleNormalized = (uvNode: Node): Node => {
        const anyUv = uvNode as any;
        const st = anyUv.mul(vec2(width, height)).sub(0.5);
        const base = st.floor();
        const f = st.fract();
        const h00 = load(base);
        const h10 = load(base.add(vec2(1, 0)));
        const h01 = load(base.add(vec2(0, 1)));
        const h11 = load(base.add(vec2(1, 1)));
        return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
    };

    const sampleNormalizedBicubic = (uvNode: Node): Node => {
        const anyUv = uvNode as any;
        const st = anyUv.mul(vec2(width, height)).sub(0.5);
        const base = st.floor();
        const f = st.fract();

        // Catmull-Rom weights per axis (same polynomials as catmullRomWeights).
        const weights = (t: any) => {
            const t2 = t.mul(t);
            const t3 = t2.mul(t);
            return [
                t3.negate().add(t2.mul(2)).sub(t).mul(0.5),
                t3.mul(3).sub(t2.mul(5)).add(2).mul(0.5),
                t3.mul(-3).add(t2.mul(4)).add(t).mul(0.5),
                t3.sub(t2).mul(0.5),
            ];
        };
        const wx = weights(f.x);
        const wy = weights(f.y);

        let result: any = float(0);
        for (let j = 0; j < 4; j += 1) {
            let rowSum: any = float(0);
            for (let i = 0; i < 4; i += 1) {
                const tap = load(base.add(vec2(i - 1, j - 1)));
                rowSum = rowSum.add((tap as any).mul(wx[i]));
            }
            result = result.add(rowSum.mul(wy[j]));
        }
        return result;
    };

    const toMeters = (normalizedNode: Node): Node =>
        (normalizedNode as any).mul(float(rangeMeters)).add(float(minMeters));

    const clampIndex = (value: number, max: number): number =>
        value < 0 ? 0 : value > max ? max : value;

    const loadCpu = (x: number, y: number): number =>
        normalized[clampIndex(y, height - 1) * width + clampIndex(x, width - 1)];

    const sampleNormalizedCpu = (u: number, v: number): number => {
        const sx = u * width - 0.5;
        const sy = v * height - 0.5;
        const bx = Math.floor(sx);
        const by = Math.floor(sy);
        const fx = sx - bx;
        const fy = sy - by;
        const h00 = loadCpu(bx, by);
        const h10 = loadCpu(bx + 1, by);
        const h01 = loadCpu(bx, by + 1);
        const h11 = loadCpu(bx + 1, by + 1);
        const top = h00 + (h10 - h00) * fx;
        const bottom = h01 + (h11 - h01) * fx;
        return top + (bottom - top) * fy;
    };

    const sampleNormalizedBicubicCpu = (u: number, v: number): number => {
        const sx = u * width - 0.5;
        const sy = v * height - 0.5;
        const bx = Math.floor(sx);
        const by = Math.floor(sy);
        const wx = catmullRomWeights(sx - bx);
        const wy = catmullRomWeights(sy - by);
        let result = 0;
        for (let j = 0; j < 4; j += 1) {
            let rowSum = 0;
            for (let i = 0; i < 4; i += 1) {
                rowSum += loadCpu(bx - 1 + i, by - 1 + j) * wx[i];
            }
            result += rowSum * wy[j];
        }
        return result;
    };

    return {
        texture,
        width,
        height,
        minMeters,
        maxMeters,
        rangeMeters,
        normalized,
        sampleNormalized,
        sampleNormalizedBicubic,
        sampleMeters: (uv) => toMeters(sampleNormalized(uv)),
        sampleMetersBicubic: (uv) => toMeters(sampleNormalizedBicubic(uv)),
        sampleNormalizedCpu,
        sampleNormalizedBicubicCpu,
        sampleMetersCpu: (u, v) => minMeters + sampleNormalizedCpu(u, v) * rangeMeters,
        sampleMetersBicubicCpu: (u, v) => minMeters + sampleNormalizedBicubicCpu(u, v) * rangeMeters,
        dispose: () => texture.dispose(),
    };
}
