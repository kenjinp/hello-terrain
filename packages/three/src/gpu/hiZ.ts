import {
  ClampToEdgeWrapping,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from "three";
import {
  Fn,
  If,
  float,
  globalId,
  ivec2,
  int,
  max,
  min,
  textureLoad,
  textureStore,
  uvec2,
  vec2,
  vec4,
} from "three/tsl";
import { RenderTarget, StorageTexture } from "three/webgpu";
import type { Node } from "three/webgpu";

const WORKGROUP_SIZE = 8;

export interface HiZTextureLevel {
  texture: StorageTexture;
  width: number;
  height: number;
}

function configureTexture(texture: StorageTexture | RenderTarget["texture"]): void {
  texture.format = RGBAFormat;
  texture.type = FloatType;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

export function createHiZCaptureTarget(
  width: number,
  height: number,
): RenderTarget {
  const target = new RenderTarget(width, height);
  configureTexture(target.texture);
  return target;
}

export function createHiZTextureLevels(resolution: number): HiZTextureLevel[] {
  const levels: HiZTextureLevel[] = [];
  let width = Math.max(1, Math.floor(resolution));
  let height = width;

  while (true) {
    const texture = new StorageTexture(width, height);
    configureTexture(texture);
    levels.push({ texture, width, height });
    if (width === 1 && height === 1) break;
    width = Math.max(1, Math.ceil(width / 2));
    height = Math.max(1, Math.ceil(height / 2));
  }

  return levels;
}

export function buildHiZCopyKernel(
  sourceTexture: RenderTarget["texture"],
  destination: HiZTextureLevel,
) {
  return Fn(() => {
    const ix = int(globalId.x);
    const iy = int(globalId.y);
    const width = int(destination.width);
    const height = int(destination.height);

    If(ix.lessThan(width).and(iy.lessThan(height)), () => {
      const sample = textureLoad(sourceTexture, ivec2(ix, iy), int(0));
      textureStore(
        destination.texture,
        uvec2(ix, iy),
        vec4(sample.r, float(0), float(0), float(1)),
      );
    });
  })().computeKernel([WORKGROUP_SIZE, WORKGROUP_SIZE, 1]);
}

export function buildHiZMipKernel(
  source: HiZTextureLevel,
  destination: HiZTextureLevel,
) {
  return Fn(() => {
    const ix = int(globalId.x);
    const iy = int(globalId.y);
    const width = int(destination.width);
    const height = int(destination.height);
    const sourceWidth = int(source.width - 1);
    const sourceHeight = int(source.height - 1);

    If(ix.lessThan(width).and(iy.lessThan(height)), () => {
      const srcX = ix.mul(int(2));
      const srcY = iy.mul(int(2));
      const a = textureLoad(source.texture, ivec2(srcX, srcY), int(0)).r;
      const b = textureLoad(
        source.texture,
        ivec2(min(srcX.add(int(1)), sourceWidth), srcY),
        int(0),
      ).r;
      const c = textureLoad(
        source.texture,
        ivec2(srcX, min(srcY.add(int(1)), sourceHeight)),
        int(0),
      ).r;
      const d = textureLoad(
        source.texture,
        ivec2(
          min(srcX.add(int(1)), sourceWidth),
          min(srcY.add(int(1)), sourceHeight),
        ),
        int(0),
      ).r;
      const reduced = max(max(a, b), max(c, d));
      textureStore(
        destination.texture,
        uvec2(ix, iy),
        vec4(reduced, float(0), float(0), float(1)),
      );
    });
  })().computeKernel([WORKGROUP_SIZE, WORKGROUP_SIZE, 1]);
}

export function sampleHiZDepth(
  levels: readonly HiZTextureLevel[],
  mipLevel: Node,
  uv: Node,
) {
  const depth = float(0).toVar("hiZDepth");

  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i]!;
    const width = Math.max(1, level.width);
    const height = Math.max(1, level.height);

    If(mipLevel.equal(int(i)), () => {
      const x = uv.x
        .mul(float(width))
        .floor()
        .toInt()
        .max(int(0))
        .min(int(width - 1));
      const y = uv.y
        .mul(float(height))
        .floor()
        .toInt()
        .max(int(0))
        .min(int(height - 1));
      depth.assign(textureLoad(level.texture, ivec2(x, y), int(0)).r);
    });
  }

  return depth;
}

export function screenRectSizeInPixels(
  minUv: Node,
  maxUv: Node,
  baseResolution: number,
) {
  const span = vec2(maxUv).sub(minUv);
  return span
    .x.max(span.y)
    .mul(float(baseResolution))
    .max(float(1));
}
