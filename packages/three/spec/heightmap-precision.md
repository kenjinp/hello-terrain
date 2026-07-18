# Heightmap Precision

## The invariant: decode before filter

Height data must never pass through the hardware texture filter while still
encoded. The GPU's fixed-function bilinear unit has **implementation-defined
precision** for unorm8 textures: desktop GPUs (NVIDIA/AMD/Intel) return
filtered results with extra fractional bits, while Apple GPUs quantize the
filtered result to roughly the storage precision.

That quantization is harmless for color textures. But if you pack a 16-bit
height into two 8-bit channels (`hi`/`lo`) and reconstruct `hi * 256 + lo`
*after* the filtered tap, the high channel's quantization error is multiplied
by 256: a 1/255 step in filtered `hi` becomes a ~1/256 step in decoded height.
Over a 1700 m elevation range that is **~6.6 m terraces** — smooth terrain on
Windows, staircases on a Mac, same Chrome version, because the browser is not
involved: WebGPU maps to D3D12 on one and Metal on the other, and different
silicon does the filtering.

The algebra of the packed reconstruction is affine in the channels, so the
trick is *mathematically* exact — in infinite precision. Hardware filtering is
not infinite precision, and no web spec requires it to be good enough for this
use. Treat "decode after filter" as wrong even where it happens to work. This
is why the RG-packed helpers (`decodeUint16RG`, `sampleHeightmapMeters`) were
removed.

## The API: `createHeightmapField`

`src/heightmap/field.ts` owns the whole primitive — texture construction,
filter modes, and reconstruction — so the invariant cannot be broken from the
outside.

```ts
import { createHeightmapField } from "@hello-terrain/three";

const field = createHeightmapField({
  data,          // Uint16Array, row-major
  width,
  height,
  minMeters: -186,
  maxMeters: 1503,
  flipY: true,   // optional: match THREE's image-texture orientation
});

// TSL (GPU) — exact on every vendor:
material.positionNode = ...field.sampleMetersBicubic(uvNode)...
material.colorNode    = ...field.sampleMeters(uvNode)...

// CPU — the same math, for physics / raycasts / spawn heights:
const groundY = field.sampleMetersCpu(u, v);
```

How it stays exact:

- **Storage is `r32float`** — a uint16 converts to f32 losslessly, and there
  is no packing to decode. (three's WebGPU backend does not support `r16uint`
  uploads: `RedIntegerFormat` only maps to 32-bit integer formats.)
- **Reads use `textureLoad`** — a samplerless texel fetch. The filter unit is
  never involved, so the optional `float32-filterable` WebGPU feature is not
  required either. Works on both the WebGPU and WebGL2 backends.
- **Interpolation runs in fp32 ALU ops** (bilinear: 4 loads; Catmull-Rom
  bicubic: 16 loads), which are IEEE-deterministic across GPUs.
- **CPU mirrors share the layout and the math** (`sample*Cpu`), so query
  results agree with the rendered surface to fp32 rounding.

The elevation compute in a terrain pipeline typically runs once per tile
rebuild, so the extra fetches versus a hardware tap are paid at tile creation,
not per frame. For per-pixel per-frame consumers whose error budget is meters
(e.g. biome color thresholds), a hardware-filtered tap of a *filterable*
format remains acceptable — but keep encoded data out of it.

## Why the tempting alternatives fall short

- **`r16float` + hardware filter**: filterable everywhere, but an f16
  mantissa quantizes to ~0.8 m at 2000 m elevation — central-difference
  normals still band on gentle slopes.
- **`r32float` + hardware filter**: needs `float32-filterable`, which Apple
  GPUs generally don't expose — unavailable exactly where you need it.
- **`r16uint`**: the natural storage, but three's WebGPU backend only maps
  `RedIntegerFormat` to 32-bit integer formats, and integer textures are
  unfilterable anyway — you'd be doing manual filtering regardless, with
  extra conversion friction.
- **`r16unorm`**: would solve everything, but it is not in core WebGPU or
  WebGL2.

## Diagnosing a report

If terrain terraces on one platform but not another, render a smooth
synthetic gradient through the suspect sampling path and visualize the height
derivative (central differences, amplified). A smooth surface has a smooth
derivative; filtered-tap quantization turns it into alternating flats and
spikes that read as stripes long before the shaded surface shows steps. If
the artifact appears only on Apple silicon and disappears when sampling via
`createHeightmapField`, it is this failure mode.
