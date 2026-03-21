 "use client";

import type { ElevationCallback } from "@hello-terrain/three";
import { decode } from "fast-png";
import { useEffect, useMemo } from "react";
import * as THREE from "three/webgpu";
import {
  cos,
  dot,
  float,
  Fn,
  floor,
  fract,
  Loop,
  mix,
  sin,
  texture,
  vec2,
} from "three/tsl";

export type TerrainStamp = {
  assetId: TerrainStampAssetId;
  center: [x: number, z: number];
  radius: number;
  height: number;
  rotation?: number;
  stretch?: [x: number, z: number];
  falloff?: number;
};

type LoadedTerrainStamp = TerrainStamp & {
  texture: THREE.DataTexture;
};

type LoadedTerrainStampAsset = {
  texture: THREE.DataTexture;
  packedData: Uint8Array;
  width: number;
  height: number;
};

type CreateStampedFbmElevationParams = {
  noiseScale: number;
  noiseFloor?: number;
  stampFieldTexture?: THREE.DataTexture;
  stampFieldScale?: number;
  stampFieldWorldSpan?: number;
};

type TerrainStampAssetMap = Record<TerrainStampAssetId, LoadedTerrainStampAsset>;
type TerrainStampTextureRecord =
  | {
      status: "pending";
      promise: Promise<void>;
    }
  | {
      status: "resolved";
      asset: LoadedTerrainStampAsset;
    }
  | {
      status: "rejected";
      error: Error;
    };

const TERRAIN_STAMPS_COMMIT = "1cd1d727c7c00aa7de1346c0fdae25bcf5e0920a";
const TERRAIN_STAMPS_CDN_BASE =
  `https://cdn.jsdelivr.net/gh/Roland09/Terrain-Stamps@${TERRAIN_STAMPS_COMMIT}/Assets/Terrain%20Stamps/`;

function createTerrainStampAsset(
  fileName: string,
  family:
    | "hills"
    | "ridged"
    | "plateaus"
    | "plateausTalus"
    | "terraceSmooth",
) {
  const encodedFileName = encodeURIComponent(fileName);

  return {
    family,
    label: fileName.replace(".png", ""),
    sourceUrl: `https://github.com/Roland09/Terrain-Stamps/blob/master/Assets/Terrain%20Stamps/${encodedFileName}`,
    downloadUrl: `${TERRAIN_STAMPS_CDN_BASE}${encodedFileName}`,
  };
}

export const terrainStampAssets = {
  hills001: createTerrainStampAsset("Stamp 001 - Hills.png", "hills"),
  hills002: createTerrainStampAsset("Stamp 002 - Hills.png", "hills"),
  hills003: createTerrainStampAsset("Stamp 003 - Hills.png", "hills"),
  hills004: createTerrainStampAsset("Stamp 004 - Hills.png", "hills"),
  ridged005: createTerrainStampAsset("Stamp 005 - Ridged.png", "ridged"),
  ridged006: createTerrainStampAsset("Stamp 006 - Ridged.png", "ridged"),
  ridged007: createTerrainStampAsset("Stamp 007 - Ridged.png", "ridged"),
  ridged008: createTerrainStampAsset("Stamp 008 - Ridged.png", "ridged"),
  plateaus009: createTerrainStampAsset("Stamp 009 - Plateaus.png", "plateaus"),
  plateaus010: createTerrainStampAsset("Stamp 010 - Plateaus.png", "plateaus"),
  plateaus011: createTerrainStampAsset("Stamp 011 - Plateaus.png", "plateaus"),
  plateaus012: createTerrainStampAsset("Stamp 012 - Plateaus.png", "plateaus"),
  plateausTalus013: createTerrainStampAsset(
    "Stamp 013 - Plateaus, Talus.png",
    "plateausTalus",
  ),
  plateausTalus014: createTerrainStampAsset(
    "Stamp 014 - Plateaus, Talus.png",
    "plateausTalus",
  ),
  plateausTalus015: createTerrainStampAsset(
    "Stamp 015 - Plateaus, Talus.png",
    "plateausTalus",
  ),
  plateausTalus016: createTerrainStampAsset(
    "Stamp 016 - Plateaus, Talus.png",
    "plateausTalus",
  ),
  terrace017: createTerrainStampAsset(
    "Stamp 017 - Terrace Smooth.png",
    "terraceSmooth",
  ),
  terrace018: createTerrainStampAsset(
    "Stamp 018 - Terrace Smooth.png",
    "terraceSmooth",
  ),
  terrace019: createTerrainStampAsset(
    "Stamp 019 - Terrace Smooth.png",
    "terraceSmooth",
  ),
  terrace020: createTerrainStampAsset(
    "Stamp 020 - Terrace Smooth.png",
    "terraceSmooth",
  ),
} as const;

export type TerrainStampAssetId = keyof typeof terrainStampAssets;

const terrainStampTextureCache = new Map<TerrainStampAssetId, TerrainStampTextureRecord>();

const randomGradient = Fn(([p]: [any]) => {
  const angle = fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)).mul(
    Math.PI * 2,
  );
  return vec2(cos(angle), sin(angle));
});

const perlinNoise = Fn(([p]: [any]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));

  const g00 = randomGradient(i);
  const g10 = randomGradient(i.add(vec2(1, 0)));
  const g01 = randomGradient(i.add(vec2(0, 1)));
  const g11 = randomGradient(i.add(vec2(1, 1)));

  const d00 = dot(g00, f);
  const d10 = dot(g10, f.sub(vec2(1, 0)));
  const d01 = dot(g01, f.sub(vec2(0, 1)));
  const d11 = dot(g11, f.sub(vec2(1, 1)));

  return mix(mix(d00, d10, u.x), mix(d01, d11, u.x), u.y).add(0.5);
});

const fbm = Fn(([posImmutable]: [any]) => {
  const p = vec2(posImmutable).toVar();
  const total = float(0).toVar();
  const amplitude = float(0.5).toVar();
  const frequency = float(1).toVar();

  Loop(6, () => {
    total.addAssign(perlinNoise(p.mul(frequency)).mul(amplitude));
    frequency.mulAssign(2.03);
    amplitude.mulAssign(0.5);
  });

  return total;
});

function packUint16HeightToRG(data: Uint16Array) {
  const packed = new Uint8Array(data.length * 2);

  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    const offset = i * 2;
    packed[offset] = value >> 8;
    packed[offset + 1] = value & 0xff;
  }

  return packed;
}

function createTerrainStampTexture(
  width: number,
  height: number,
  data: Uint16Array,
) {
  const textureData = packUint16HeightToRG(data);
  const stampTexture = new THREE.DataTexture(
    textureData,
    width,
    height,
    THREE.RGFormat,
    THREE.UnsignedByteType,
  );
  stampTexture.wrapS = THREE.ClampToEdgeWrapping;
  stampTexture.wrapT = THREE.ClampToEdgeWrapping;
  stampTexture.minFilter = THREE.LinearFilter;
  stampTexture.magFilter = THREE.LinearFilter;
  stampTexture.generateMipmaps = false;
  stampTexture.colorSpace = THREE.NoColorSpace;
  stampTexture.flipY = true;
  stampTexture.needsUpdate = true;
  return stampTexture;
}

async function loadTerrainStampTexture(assetId: TerrainStampAssetId) {
  const response = await fetch(terrainStampAssets[assetId].downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to load terrain stamp asset: ${assetId}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const image = decode(bytes);

  if (image.channels !== 1 || image.depth !== 16 || !(image.data instanceof Uint16Array)) {
    throw new Error(`Terrain stamp asset must be grayscale 16-bit PNG: ${assetId}`);
  }

  const texture = createTerrainStampTexture(image.width, image.height, image.data);

  return {
    texture,
    packedData: texture.image.data as Uint8Array,
    width: image.width,
    height: image.height,
  };
}

function readTerrainStampTexture(assetId: TerrainStampAssetId) {
  const cached = terrainStampTextureCache.get(assetId);

  if (cached?.status === "resolved") {
    return cached.asset;
  }

  if (cached?.status === "rejected") {
    throw cached.error;
  }

  if (cached?.status === "pending") {
    throw cached.promise;
  }

  const promise = loadTerrainStampTexture(assetId).then(
    (asset) => {
      terrainStampTextureCache.set(assetId, {
        status: "resolved",
        asset,
      });
    },
    (nextError) => {
      terrainStampTextureCache.set(assetId, {
        status: "rejected",
        error: nextError instanceof Error ? nextError : new Error(String(nextError)),
      });
    },
  );

  terrainStampTextureCache.set(assetId, {
    status: "pending",
    promise,
  });

  throw promise;
}

export function useTerrainStampTexturesSuspense(assetIds: TerrainStampAssetId[]) {
  const uniqueAssetIds = useMemo(
    () => [...new Set(assetIds)].sort() as TerrainStampAssetId[],
    [assetIds],
  );

  return useMemo(
    () =>
      Object.fromEntries(
        uniqueAssetIds.map((assetId) => [assetId, readTerrainStampTexture(assetId)]),
      ) as TerrainStampAssetMap,
    [uniqueAssetIds],
  );
}

function smoothstepNumber(edge0: number, edge1: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function samplePackedStampData(
  packedData: Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
) {
  const x = Math.max(0, Math.min(width - 1, u * (width - 1)));
  const y = Math.max(0, Math.min(height - 1, v * (height - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;

  const readPixel = (px: number, py: number) => {
    const offset = (py * width + px) * 2;
    const hi = packedData[offset] ?? 0;
    const lo = packedData[offset + 1] ?? 0;
    return (hi * 256 + lo) / 65535;
  };

  const s00 = readPixel(x0, y0);
  const s10 = readPixel(x1, y0);
  const s01 = readPixel(x0, y1);
  const s11 = readPixel(x1, y1);
  const sx0 = s00 * (1 - tx) + s10 * tx;
  const sx1 = s01 * (1 - tx) + s11 * tx;
  return sx0 * (1 - ty) + sx1 * ty;
}

function createPackedHeightFieldTexture(field: Float32Array, scale: number, resolution: number) {
  const packed = new Uint8Array(field.length * 2);
  const safeScale = scale > 0 ? scale : 1;

  for (let i = 0; i < field.length; i += 1) {
    const normalized = Math.max(0, Math.min(1, field[i] / safeScale));
    const encoded = Math.round(normalized * 65535);
    const offset = i * 2;
    packed[offset] = encoded >> 8;
    packed[offset + 1] = encoded & 0xff;
  }

  const texture = new THREE.DataTexture(
    packed,
    resolution,
    resolution,
    THREE.RGFormat,
    THREE.UnsignedByteType,
  );
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

function composeTerrainStampField(
  stamps: LoadedTerrainStamp[],
  worldSpan: number,
  resolution: number,
) {
  const field = new Float32Array(resolution * resolution);
  let maxValue = 0;

  for (let y = 0; y < resolution; y += 1) {
    const worldZ = ((y + 0.5) / resolution - 0.5) * worldSpan;

    for (let x = 0; x < resolution; x += 1) {
      const worldX = ((x + 0.5) / resolution - 0.5) * worldSpan;
      let elevation = 0;

      for (const stamp of stamps) {
        const [centerX, centerZ] = stamp.center;
        const [stretchX, stretchZ] = stamp.stretch ?? [1, 1];
        const rotation = stamp.rotation ?? 0;
        const radiusX = Math.max(stamp.radius * stretchX, 0.001);
        const radiusZ = Math.max(stamp.radius * stretchZ, 0.001);
        const localX = worldX - centerX;
        const localZ = worldZ - centerZ;
        const cosRotation = Math.cos(rotation);
        const sinRotation = Math.sin(rotation);
        const rotatedX = localX * cosRotation - localZ * sinRotation;
        const rotatedZ = localX * sinRotation + localZ * cosRotation;
        const normalizedX = rotatedX / radiusX;
        const normalizedZ = rotatedZ / radiusZ;
        const distance = Math.hypot(normalizedX, normalizedZ);
        const edgeFade = Math.min(Math.max(stamp.falloff ?? 0.18, 0.02), 0.45);
        const radialMask = 1 - smoothstepNumber(1 - edgeFade, 1, distance);
        const boxMaskX = 1 - smoothstepNumber(1 - edgeFade, 1, Math.abs(normalizedX));
        const boxMaskY = 1 - smoothstepNumber(1 - edgeFade, 1, Math.abs(normalizedZ));
        const blendMask = radialMask * boxMaskX * boxMaskY;

        if (blendMask <= 0) {
          continue;
        }

        const sample = samplePackedStampData(
          stamp.texture.image.data as Uint8Array,
          stamp.texture.image.width,
          stamp.texture.image.height,
          normalizedX * 0.5 + 0.5,
          normalizedZ * 0.5 + 0.5,
        );
        const contribution = sample * blendMask * stamp.height;
        const targetElevation = Math.max(elevation, contribution);
        elevation = elevation * (1 - blendMask) + targetElevation * blendMask;
      }

      field[y * resolution + x] = elevation;
      maxValue = Math.max(maxValue, elevation);
    }
  }

  return {
    texture: createPackedHeightFieldTexture(field, maxValue || 1, resolution),
    scale: maxValue || 1,
    worldSpan,
  };
}

export function useTerrainStampFieldSuspense(
  stamps: TerrainStamp[],
  {
    resolution = 1024,
    worldSpan,
  }: {
    resolution?: number;
    worldSpan: number;
  },
) {
  const assetIds = useMemo(
    () => [...new Set(stamps.map((stamp) => stamp.assetId))] as TerrainStampAssetId[],
    [stamps],
  );
  const stampAssetMap = useTerrainStampTexturesSuspense(assetIds);
  const loadedTerrainStamps = useMemo(
    () =>
      stamps.map((stamp) => ({
        ...stamp,
        texture: stampAssetMap[stamp.assetId].texture,
      })),
    [stampAssetMap, stamps],
  );
  const stampField = useMemo(
    () => composeTerrainStampField(loadedTerrainStamps, worldSpan, resolution),
    [loadedTerrainStamps, resolution, worldSpan],
  );

  useEffect(() => {
    return () => {
      stampField.texture.dispose();
    };
  }, [stampField]);

  return stampField;
}

export function createStampedFbmElevation({
  noiseScale,
  noiseFloor = 0.3,
  stampFieldTexture,
  stampFieldScale = 0,
  stampFieldWorldSpan = 1,
}: CreateStampedFbmElevationParams): ElevationCallback {
  return ({ worldPosition }) => {
    const p = vec2(worldPosition.x, worldPosition.z).mul(float(noiseScale));
    let elevation = fbm(p).sub(float(noiseFloor));

    if (stampFieldTexture) {
      const stampUv = vec2(worldPosition.x, worldPosition.z)
        .div(float(stampFieldWorldSpan))
        .add(0.5)
        .clamp();
      const stampSample = texture(stampFieldTexture, stampUv);
      const stampElevation = stampSample.r
        .mul(float(256))
        .add(stampSample.g)
        .div(float(257))
        .mul(float(stampFieldScale));
      elevation = elevation.add(stampElevation);
    }

    return elevation;
  };
}
