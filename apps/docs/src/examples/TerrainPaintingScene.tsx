"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import {
  PAINT_MODE,
  PaintingToolbar,
  createBrushPreviewUniforms,
  createPaintableTerrainColorNode,
  usePaintingState,
} from "@/components/Painting";
import { Skybox } from "@/components/Skybox";
import * as hello from "@hello-terrain/react";
import {
  ControlFn,
  ElevationFn,
  type TerrainMesh,
  TerrainTextureArray,
  createTerrainColorNode,
  createTerrainRoughnessNode,
  distanceBasedSubdivision,
} from "@hello-terrain/three";
import { Environment, OrbitControls, useTexture } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  clamp,
  float,
  select,
  smoothstep,
  texture,
  transformNormalToView,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

// biome-ignore lint/suspicious/noExplicitAny: recommended by drei
extend(THREE as any);

const VERTEX_COUNT = 64;
const SEGMENT_COUNT = VERTEX_COUNT - 3;

// Paint texture resolution
const PAINT_TEXTURE_SIZE = 1024;

/**
 * Load an image as ImageData with optional resizing
 */
async function loadImageData(
  url: string,
  targetSize?: number
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = targetSize ?? img.width;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      resolve(imageData);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Load a texture set (albedo, normal, height, roughness)
 */
async function loadTextureSet(basePath: string, targetSize: number) {
  const isWavySand = basePath.includes("wavy-sand");
  const colorSuffix = isWavySand ? "_albedo.png" : "-color.png";
  const normalSuffix = isWavySand ? "_normal-ogl.png" : "-normal.png";
  const heightSuffix = isWavySand ? "_height.png" : "-height.png";
  const roughSuffix = isWavySand ? "_roughness.png" : "-rough.png";

  const [albedo, normal, height, roughness] = await Promise.all([
    loadImageData(`${basePath}${colorSuffix}`, targetSize),
    loadImageData(`${basePath}${normalSuffix}`, targetSize),
    loadImageData(`${basePath}${heightSuffix}`, targetSize),
    loadImageData(`${basePath}${roughSuffix}`, targetSize),
  ]);
  return { albedo, normal, height, roughness };
}

// Texture IDs
const TEXTURE_IDS = {
  grass: 0,
  rock: 1,
  slate: 2,
  snow: 3,
  mud: 4,
  sand: 5,
} as const;

/**
 * Create a paint texture using DataTexture for reliable WebGPU updates
 * Paint texture format:
 * - R: base texture ID (0-31 mapped to 0-255)
 * - G: overlay texture ID (0-31 mapped to 0-255)
 * - B: blend factor (0-255)
 * - A: paint mask (0 = use procedural, 255 = use painted)
 */
function createPaintTexture(size: number) {
  // Create Uint8Array for RGBA data
  const data = new Uint8Array(size * size * 4);
  // Initialize with transparent (all zeros = no paint)

  // Create Three.js DataTexture
  const threeTexture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  threeTexture.minFilter = THREE.LinearFilter;
  threeTexture.magFilter = THREE.LinearFilter;
  threeTexture.wrapS = THREE.ClampToEdgeWrapping;
  threeTexture.wrapT = THREE.ClampToEdgeWrapping;
  threeTexture.flipY = false;
  threeTexture.generateMipmaps = false;
  threeTexture.needsUpdate = true;

  return { data, texture: threeTexture, size };
}

/**
 * Create a height modification texture using DataTexture
 * Height texture format:
 * - R: height delta (128 = no change, 0 = max lower, 255 = max raise)
 * - A: modification strength (0 = no modification, 255 = full modification)
 */
function createHeightTexture(size: number) {
  // Create Uint8Array for RGBA data
  const data = new Uint8Array(size * size * 4);
  // Initialize with neutral height (128 = no change) and zero alpha (no modification)
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 128; // R: neutral height
    data[i * 4 + 1] = 0; // G: unused
    data[i * 4 + 2] = 0; // B: unused
    data[i * 4 + 3] = 0; // A: no modification
  }

  // Create Three.js DataTexture
  const threeTexture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  threeTexture.minFilter = THREE.LinearFilter;
  threeTexture.magFilter = THREE.LinearFilter;
  threeTexture.wrapS = THREE.ClampToEdgeWrapping;
  threeTexture.wrapT = THREE.ClampToEdgeWrapping;
  threeTexture.flipY = false;
  threeTexture.generateMipmaps = false;
  threeTexture.needsUpdate = true;

  return { data, texture: threeTexture, size };
}

interface PaintTextureRef {
  data: Uint8Array;
  texture: THREE.DataTexture;
  size: number;
}

interface HeightTextureRef {
  data: Uint8Array;
  texture: THREE.DataTexture;
  size: number;
}

interface TerrainPlaneProps {
  brushUniforms: ReturnType<typeof createBrushPreviewUniforms>;
  paintingState: ReturnType<typeof usePaintingState>["state"];
  paintingActions: ReturnType<typeof usePaintingState>["actions"];
}

const TerrainPlane = ({
  brushUniforms,
  paintingState,
  paintingActions,
}: TerrainPlaneProps) => {
  const { camera, gl, pointer } = useThree();
  const [terrain, setTerrain] = useState<TerrainMesh | null>(null);
  const [textureArray, setTextureArray] = useState<TerrainTextureArray | null>(
    null
  );

  // Create paint texture lazily but synchronously on first access
  const paintTextureRef = useRef<PaintTextureRef | null>(null);
  if (!paintTextureRef.current) {
    paintTextureRef.current = createPaintTexture(PAINT_TEXTURE_SIZE);
  }

  // Create height modification texture lazily but synchronously on first access
  const heightTextureRef = useRef<HeightTextureRef | null>(null);
  if (!heightTextureRef.current) {
    heightTextureRef.current = createHeightTexture(PAINT_TEXTURE_SIZE);
  }

  // Track mouse state for painting
  const isMouseDownRef = useRef(false);
  const lastPaintPosRef = useRef<{ x: number; z: number } | null>(null);

  const setMetric = useMetrics([
    "brushPosition",
    "nodeCount",
    "activeLeafCount",
    "paintStrokes",
  ] as const);

  // Paint stroke counter
  const paintStrokeCountRef = useRef(0);

  // Terrain settings
  const rootSize = 1024 * 4;
  const heightmapScale = 1500;
  const textureScale = 50;

  // Load heightmap texture
  const heightmapTexture = useTexture("/assets/heightmaps/0001_h.png");

  // Configure heightmap texture
  useEffect(() => {
    if (heightmapTexture) {
      heightmapTexture.minFilter = THREE.LinearFilter;
      heightmapTexture.magFilter = THREE.LinearFilter;
      heightmapTexture.wrapS = THREE.ClampToEdgeWrapping;
      heightmapTexture.wrapT = THREE.ClampToEdgeWrapping;
      heightmapTexture.needsUpdate = true;
    }
  }, [heightmapTexture]);

  // Load terrain textures
  useEffect(() => {
    const loadTextures = async () => {
      const texArray = new TerrainTextureArray({
        resolution: 512,
        maxTextures: 32,
        generateMipmaps: true,
      });

      const basePath = "/assets/terrain-textures";
      const textureResolution = 512;

      const [grass, rock, slate, snow, mud, sand] = await Promise.all([
        loadTextureSet(`${basePath}/grass/grass`, textureResolution),
        loadTextureSet(`${basePath}/rock/rock`, textureResolution),
        loadTextureSet(`${basePath}/slate/slate`, textureResolution),
        loadTextureSet(`${basePath}/snow/snow`, textureResolution),
        loadTextureSet(`${basePath}/mud/mud`, textureResolution),
        loadTextureSet(`${basePath}/sand/wavy-sand`, textureResolution),
      ]);

      texArray.addTextureSet(
        grass.albedo,
        grass.normal,
        grass.height,
        grass.roughness
      );
      texArray.addTextureSet(
        rock.albedo,
        rock.normal,
        rock.height,
        rock.roughness
      );
      texArray.addTextureSet(
        slate.albedo,
        slate.normal,
        slate.height,
        slate.roughness
      );
      texArray.addTextureSet(
        snow.albedo,
        snow.normal,
        snow.height,
        snow.roughness
      );
      texArray.addTextureSet(mud.albedo, mud.normal, mud.height, mud.roughness);
      texArray.addTextureSet(
        sand.albedo,
        sand.normal,
        sand.height,
        sand.roughness
      );

      setTextureArray(texArray);
    };

    loadTextures().catch(console.error);
  }, []);

  // Get height modification texture (guaranteed to exist due to synchronous initialization)
  // biome-ignore lint/style/noNonNullAssertion: heightTextureRef is initialized synchronously
  const heightModTexture = heightTextureRef.current!.texture;

  // Maximum height modification in normalized units (relative to heightmapScale)
  const maxHeightDelta = 100; // 20% of heightmapScale = 300 units max

  // Elevation function with height modification support
  const elevationFn = useMemo(() => {
    return ElevationFn(({ worldPosition, rootSize: rs }) => {
      const uv = vec2(
        worldPosition.x.div(rs).add(0.5),
        worldPosition.z.div(rs).add(0.5)
      );

      // Sample base heightmap
      const heightSample = texture(heightmapTexture, uv);
      const baseHeight = heightSample.r;

      // Sample height modification texture
      const heightMod = texture(heightModTexture, uv);
      // R channel: 128 = no change, 0 = -1, 255 = +1
      // Convert from [0,1] to [-1,1]: (r - 0.5) * 2
      const heightDelta = heightMod.r.sub(0.5).mul(2);
      // A channel: modification strength [0,1]
      const modStrength = heightMod.a;

      // Apply height modification: base + delta * strength * maxDelta
      // When modStrength is 0 (no paint), this just returns baseHeight
      return baseHeight.add(heightDelta.mul(modStrength).mul(maxHeightDelta));
    });
  }, [heightmapTexture, heightModTexture]);

  // Control uniforms for procedural texturing
  const controlUniforms = useMemo(
    () => ({
      heightScale: uniform(heightmapScale),
      slopeThresholdCos: uniform(Math.cos((50 * Math.PI) / 180)),
      slopeBlendCos: uniform(Math.cos((40 * Math.PI) / 180)),
    }),
    []
  );

  // Control function that blends procedural with painted data
  // Note: This should NOT change after initial creation - the texture updates via needsUpdate
  const controlFn = useMemo(() => {
    // Paint texture is guaranteed to exist due to synchronous initialization above
    // biome-ignore lint/style/noNonNullAssertion: paintTextureRef is initialized synchronously before this useMemo
    const paintTex = paintTextureRef.current!.texture;

    // Control function with paint texture sampling
    return ControlFn(({ height, normal, worldPosition, rootSize: rs }) => {
      const scaledHeight = height.mul(controlUniforms.heightScale);

      // Sample paint texture
      // UV matches world position, canvas painting is pre-flipped to match
      const paintUV = vec2(
        worldPosition.x.div(rs).add(0.5),
        worldPosition.z.div(rs).add(0.5)
      );
      const paintSample = texture(paintTex, paintUV);
      const paintMask = paintSample.a; // 0 = procedural, 1 = painted

      // Decode painted values from texture
      // R: (legacy/unused for now)
      // G: painted overlay texture ID (0-1 maps to 0-31)
      // B: painted "max blend" (0-1), combined with A for soft edges
      const paintedOverlayId = paintSample.g.mul(31).floor().toUint();

      // Procedural texturing
      const grassId = uint(TEXTURE_IDS.grass);
      const rockId = uint(TEXTURE_IDS.rock);
      const sandId = uint(TEXTURE_IDS.sand);
      const snowId = uint(TEXTURE_IDS.snow);

      const normalY = normal.y;
      const slopeRange = controlUniforms.slopeBlendCos.sub(
        controlUniforms.slopeThresholdCos
      );
      const slopeT = clamp(
        controlUniforms.slopeBlendCos.sub(normalY).div(slopeRange),
        0,
        1
      );
      const slopeBlendFactor = smoothstep(float(0), float(1), slopeT);
      const isSteep = slopeBlendFactor.greaterThan(float(0.3));

      const lowAltitude = float(200);
      const snowAltitude = float(1200);
      const isLow = scaledHeight.lessThan(lowAltitude);
      const isSnow = scaledHeight.greaterThan(snowAltitude);

      const flatBase = select(
        isLow.and(isSteep.not()),
        sandId,
        select(isSnow.and(isSteep.not()), snowId, grassId)
      );
      const proceduralBase = select(isSteep, rockId, flatBase);
      const proceduralOverlay = proceduralBase;
      const proceduralBlend = float(0);

      // Painting is expressed as an OVERLAY on top of the procedural base.
      // This avoids changing texture IDs across vertices (which causes banding) and
      // instead uses the blend factor for smooth transitions.
      //
      // - Base stays procedural
      // - Overlay becomes the painted texture where A>0
      // - Blend is (paintMask * paintSample.b) mapped to 0..255 so brush softness
      //   creates a smooth edge.
      const isPainted = paintMask.greaterThan(float(0.001));

      const finalBaseId = proceduralBase;
      const finalOverlayId = select(
        isPainted,
        paintedOverlayId,
        proceduralOverlay
      );
      const finalBlend = select(
        isPainted,
        paintMask.mul(paintSample.b).mul(255),
        proceduralBlend
      );
      const uvScale = uint(0);

      const packed = finalBaseId
        .shiftLeft(uint(27))
        .bitOr(finalOverlayId.shiftLeft(uint(22)))
        .bitOr(finalBlend.toUint().shiftLeft(uint(14)))
        .bitOr(uvScale.shiftLeft(uint(10)));

      return packed;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlUniforms]);

  // Set controlFn on terrain
  useEffect(() => {
    if (terrain && controlFn) {
      terrain.controlFn = controlFn;
    }
  }, [terrain, controlFn]);

  // Texture uniforms
  const textureUniforms = useMemo(
    () => ({
      textureScale: uniform(textureScale),
      heightBlendSharpness: uniform(4),
      triplanarSharpness: uniform(2),
      debugMode: uniform(0),
      variationScale: uniform(0.01),
      transitionBlendWidth: uniform(0.3),
      // Enhanced blending parameters (using defaults)
      blendMode: uniform(1), // height-based blending
      noiseBlur: uniform(0.5),
      noiseAmplitude: uniform(1.25),
      noiseWavelength: uniform(16384),
      noiseAccuracy: uniform(1.25),
      saturation: uniform(1.0),
    }),
    []
  );

  // Position node
  const positionNode = useMemo(() => {
    if (!terrain) {
      return Fn(() => vec3(0, 0, 0))();
    }
    return terrain.positionNode();
  }, [terrain]);

  // Color node with brush preview
  const colorNode = useMemo(() => {
    if (!terrain || !textureArray) {
      return Fn(() => vec4(0.5, 0.5, 0.5, 1))();
    }

    const baseColorNode = createTerrainColorNode({
      varyings: terrain.varyings,
      uniforms: terrain.uniforms,
      textureArray,
      textureScale: textureUniforms.textureScale,
      heightBlendSharpness: textureUniforms.heightBlendSharpness,
      triplanarSharpness: textureUniforms.triplanarSharpness,
      debugMode: textureUniforms.debugMode,
      variationScale: textureUniforms.variationScale,
      transitionBlendWidth: textureUniforms.transitionBlendWidth,
      blendMode: textureUniforms.blendMode,
      noiseBlur: textureUniforms.noiseBlur,
      noiseAmplitude: textureUniforms.noiseAmplitude,
      noiseWavelength: textureUniforms.noiseWavelength,
      noiseAccuracy: textureUniforms.noiseAccuracy,
      saturation: textureUniforms.saturation,
    });

    return createPaintableTerrainColorNode({
      baseColorNode,
      textureArray,
      brushUniforms,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      textureScale: textureUniforms.textureScale as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      triplanarSharpness: textureUniforms.triplanarSharpness as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      variationScale: textureUniforms.variationScale as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      normalNode: terrain.varyings.vNormal as any,
    });
  }, [terrain, textureArray, textureUniforms, brushUniforms]);

  // Normal node
  const normalNode = useMemo(() => {
    if (!terrain) {
      return Fn(() => vec3(0, 1, 0))();
    }
    return transformNormalToView(terrain.varyings.vNormal);
  }, [terrain]);

  // Roughness node
  const roughnessNode = useMemo(() => {
    if (!terrain || !textureArray) {
      return Fn(() => float(0.5))();
    }
    return createTerrainRoughnessNode({
      varyings: terrain.varyings,
      uniforms: terrain.uniforms,
      textureArray,
      textureScale: textureUniforms.textureScale,
      heightBlendSharpness: textureUniforms.heightBlendSharpness,
      triplanarSharpness: textureUniforms.triplanarSharpness,
      debugMode: textureUniforms.debugMode,
      variationScale: textureUniforms.variationScale,
      transitionBlendWidth: textureUniforms.transitionBlendWidth,
      blendMode: textureUniforms.blendMode,
      noiseBlur: textureUniforms.noiseBlur,
      noiseAmplitude: textureUniforms.noiseAmplitude,
      noiseWavelength: textureUniforms.noiseWavelength,
      noiseAccuracy: textureUniforms.noiseAccuracy,
      saturation: textureUniforms.saturation,
    });
  }, [terrain, textureArray, textureUniforms]);

  // Handle painting - draw to paint texture or height texture (DataTexture)
  const handlePaint = useCallback(
    (worldX: number, worldZ: number) => {
      const paintRef = paintTextureRef.current;
      const heightRef = heightTextureRef.current;
      if (!paintRef || !heightRef) return;

      const size = paintRef.size;

      // Convert world position to texture pixel coordinates
      // DataTexture with flipY=false: array row 0 = UV.y=0 = bottom
      // Shader UV: worldPosition.z / rootSize + 0.5 maps -rootSize/2 to 0, +rootSize/2 to 1
      // So array row should match directly (no flip needed)
      const centerU = (worldX / rootSize + 0.5) * size;
      const centerV = (worldZ / rootSize + 0.5) * size;

      // Convert brush radius from world units to texture pixels
      const brushRadiusPx = (paintingState.brush.radius / rootSize) * size;
      const brushRadiusSq = brushRadiusPx * brushRadiusPx;

      const softness = paintingState.brush.softness;
      const innerRadius = brushRadiusPx * (1 - softness);
      const innerRadiusSq = innerRadius * innerRadius;

      // Calculate bounding box for the brush
      const minX = Math.max(0, Math.floor(centerU - brushRadiusPx));
      const maxX = Math.min(size - 1, Math.ceil(centerU + brushRadiusPx));
      const minY = Math.max(0, Math.floor(centerV - brushRadiusPx));
      const maxY = Math.min(size - 1, Math.ceil(centerV + brushRadiusPx));

      const maxAlpha = Math.round(paintingState.brush.strength * 255);

      // Check if we're in heightmap mode
      const isHeightmapMode =
        paintingState.mode === PAINT_MODE.HEIGHTMAP_RAISE ||
        paintingState.mode === PAINT_MODE.HEIGHTMAP_LOWER;

      if (isHeightmapMode) {
        // Height painting mode
        const { data, texture: heightTex } = heightRef;

        // Height delta value: 255 = max raise, 0 = max lower, 128 = no change
        const heightValue =
          paintingState.mode === PAINT_MODE.HEIGHTMAP_RAISE ? 255 : 0;

        // Paint pixels within the brush radius
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const dx = x - centerU;
            const dy = y - centerV;
            const distSq = dx * dx + dy * dy;

            if (distSq <= brushRadiusSq) {
              // Calculate falloff based on distance
              let brushAlpha = 1.0;
              if (softness > 0 && distSq > innerRadiusSq) {
                const dist = Math.sqrt(distSq);
                const falloffRange = brushRadiusPx - innerRadius;
                if (falloffRange > 0) {
                  const t = (dist - innerRadius) / falloffRange;
                  brushAlpha = 1 - t;
                }
              }

              const alpha = Math.round(maxAlpha * brushAlpha);
              const idx = (y * size + x) * 4;

              // Blend height modification
              const existingAlpha = data[idx + 3];
              if (alpha > 0) {
                const blendFactor = alpha / 255;
                // Blend the height value towards the target
                data[idx] = Math.round(
                  data[idx] * (1 - blendFactor) + heightValue * blendFactor
                );
                // Accumulate modification strength
                data[idx + 3] = Math.min(255, Math.max(existingAlpha, alpha));
              }
            }
          }
        }

        // Mark height texture for GPU re-upload
        heightTex.needsUpdate = true;
      } else {
        // Texture painting mode
        const { data, texture: paintTex } = paintRef;

        // Determine what to paint based on mode.
        //
        // Painting is stored as:
        // - G: overlay texture id (0..31 mapped to 0..255)
        // - B: max blend (0..255) (multiplied by A in the shader for soft edges)
        // - A: paint mask/strength with softness falloff (0..255)
        //
        // R is currently unused (kept for compatibility).
        let overlayId = paintingState.selectedTextureId;
        let blendByte = 255; // default: full blend potential, scaled by A falloff in shader

        if (paintingState.mode === PAINT_MODE.BASE_TEXTURE) {
          overlayId = paintingState.selectedTextureId;
          blendByte = 255;
        } else if (paintingState.mode === PAINT_MODE.OVERLAY_TEXTURE) {
          overlayId = paintingState.selectedTextureId;
          blendByte = 255;
        } else if (paintingState.mode === PAINT_MODE.BLEND) {
          // Blend mode: only adjust B; keep existing overlay id
          blendByte = Math.round(paintingState.brush.strength * 255);
        }

        const rByte = 0;
        const gByte = Math.round((overlayId / 31) * 255);
        const bByte = blendByte;

        // Paint pixels within the brush radius
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const dx = x - centerU;
            const dy = y - centerV;
            const distSq = dx * dx + dy * dy;

            if (distSq <= brushRadiusSq) {
              // Calculate falloff based on distance
              let brushAlpha = 1.0;
              if (softness > 0 && distSq > innerRadiusSq) {
                const dist = Math.sqrt(distSq);
                const falloffRange = brushRadiusPx - innerRadius;
                if (falloffRange > 0) {
                  const t = (dist - innerRadius) / falloffRange;
                  brushAlpha = 1 - t;
                }
              }

              const alpha = Math.round(maxAlpha * brushAlpha);
              const idx = (y * size + x) * 4;

              // Blend new paint on top of existing.
              const existingAlpha = data[idx + 3];
              if (alpha > 0) {
                if (existingAlpha === 0) {
                  data[idx] = rByte; // unused
                  data[idx + 1] = gByte;
                  data[idx + 2] = bByte;
                  data[idx + 3] = alpha;
                } else {
                  const blendFactor = alpha / 255;
                  // Only update channels relevant to the current mode.
                  // - BLEND: update B only
                  // - BASE/OVERLAY: update G and B
                  if (paintingState.mode === PAINT_MODE.BLEND) {
                    data[idx + 2] = Math.round(
                      data[idx + 2] * (1 - blendFactor) + bByte * blendFactor
                    );
                  } else {
                    data[idx + 1] = Math.round(
                      data[idx + 1] * (1 - blendFactor) + gByte * blendFactor
                    );
                    data[idx + 2] = Math.round(
                      data[idx + 2] * (1 - blendFactor) + bByte * blendFactor
                    );
                  }
                  data[idx + 3] = Math.min(255, Math.max(existingAlpha, alpha));
                }
              }
            }
          }
        }

        // Mark paint texture for GPU re-upload
        paintTex.needsUpdate = true;
      }

      // Force terrain to recompute with new data
      terrain?.invalidate();

      // Update stroke counter
      paintStrokeCountRef.current++;
      setMetric("paintStrokes", paintStrokeCountRef.current.toString());
    },
    [paintingState, setMetric, terrain]
  );

  // Update brush position and handle painting each frame
  useFrame(() => {
    if (!terrain) return;

    // Update terrain
    const renderer = gl as unknown as THREE.WebGPURenderer;
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);
    terrain.update(renderer, camera.position, frustum);

    // Raycast for brush position using ground plane
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, intersection);

    if (intersection) {
      // Update brush uniforms
      brushUniforms.brushPosition.value.set(intersection.x, intersection.z);
      brushUniforms.brushActive.value =
        paintingState.mode !== PAINT_MODE.OFF ? 1 : 0;
      brushUniforms.brushRadius.value = paintingState.brush.radius;
      brushUniforms.brushSoftness.value = paintingState.brush.softness;
      brushUniforms.brushStrength.value = paintingState.brush.strength;
      brushUniforms.previewTextureId.value = paintingState.selectedTextureId;
      brushUniforms.previewMode.value = paintingState.mode;

      setMetric(
        "brushPosition",
        `${intersection.x.toFixed(0)}, ${intersection.z.toFixed(0)}`
      );

      // Handle continuous painting while mouse is down
      if (isMouseDownRef.current && paintingState.mode !== PAINT_MODE.OFF) {
        const lastPos = lastPaintPosRef.current;
        const paintSpacing = paintingState.brush.radius * 0.25;

        if (
          !lastPos ||
          Math.hypot(intersection.x - lastPos.x, intersection.z - lastPos.z) >=
            paintSpacing
        ) {
          handlePaint(intersection.x, intersection.z);
          lastPaintPosRef.current = { x: intersection.x, z: intersection.z };
        }
      }
    } else {
      brushUniforms.brushActive.value = 0;
    }

    // Update control uniforms
    controlUniforms.heightScale.value = heightmapScale;

    // Update metrics
    setMetric(
      "nodeCount",
      `${terrain.metrics.leafNodeCount} / ${terrain.metrics.nodeCount}`
    );
    setMetric(
      "activeLeafCount",
      (terrain.metrics.activeLeafCount ?? 0).toString()
    );
  });

  // Mouse event handlers
  useEffect(() => {
    const canvas = gl.domElement;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && paintingState.mode !== PAINT_MODE.OFF) {
        isMouseDownRef.current = true;
        paintingActions.setIsPainting(true);
        lastPaintPosRef.current = null;
      }
    };

    const handleMouseUp = () => {
      isMouseDownRef.current = false;
      paintingActions.setIsPainting(false);
      lastPaintPosRef.current = null;
    };

    const handleMouseLeave = () => {
      brushUniforms.brushActive.value = 0;
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [gl, paintingState.mode, paintingActions, brushUniforms]);

  // Keyboard shortcuts for brush size
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "[") {
        paintingActions.setBrushRadius(
          Math.max(5, paintingState.brush.radius - 10)
        );
      } else if (e.key === "]") {
        paintingActions.setBrushRadius(
          Math.min(500, paintingState.brush.radius + 10)
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paintingState.brush.radius, paintingActions]);

  if (!textureArray) {
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="gray" />
      </mesh>
    );
  }

  return (
    <>
      <hello.TerrainMesh
        ref={setTerrain}
        innerTileSegments={SEGMENT_COUNT}
        elevationFn={elevationFn}
        controlFn={controlFn}
        frustumCulling={true}
        maxLevel={8}
        rootSize={rootSize}
        subdivisionStrategy={distanceBasedSubdivision(2, 0.15)}
        minNodeSize={SEGMENT_COUNT}
      >
        <meshStandardNodeMaterial
          positionNode={positionNode}
          colorNode={colorNode}
          normalNode={normalNode}
          roughnessNode={roughnessNode}
        />
      </hello.TerrainMesh>

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        maxPolarAngle={Math.PI / 2 - 0.1}
        mouseButtons={{
          LEFT:
            paintingState.mode !== PAINT_MODE.OFF
              ? undefined
              : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
      />

      <ambientLight intensity={0.5} />
      <directionalLight position={[100, 200, 50]} intensity={1.5} />
      <Environment
        preset="park"
        background={false}
        environmentIntensity={0.8}
      />
      <Skybox size={rootSize * 2} />
    </>
  );
};

export default function TerrainPaintingScene() {
  // Create brush uniforms (shared between scene and UI)
  const brushUniforms = useMemo(() => createBrushPreviewUniforms(), []);

  // Painting state
  const { state: paintingState, actions: paintingActions } = usePaintingState();

  return (
    <div className="relative w-full h-full">
      <Canvas
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
        camera={{
          position: [500, 400, 500],
          fov: 75,
          near: 0.1,
          far: Number.MAX_SAFE_INTEGER,
        }}
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer(
            props as WebGPURendererParameters
          );
          await renderer.init();
          return renderer;
        }}
      >
        <color attach="background" args={["#87CEEB"]} />
        <TerrainPlane
          brushUniforms={brushUniforms}
          paintingState={paintingState}
          paintingActions={paintingActions}
        />
      </Canvas>

      {/* Painting Toolbar */}
      <PaintingToolbar
        state={paintingState}
        actions={paintingActions}
        className="absolute top-8 right-8 z-10"
      />
    </div>
  );
}
