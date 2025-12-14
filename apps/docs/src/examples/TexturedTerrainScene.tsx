"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import * as hello from "@hello-terrain/react";
import {
  ControlFn,
  ElevationFn,
  type ScreenSpaceInfo,
  type SubdivisionStrategy,
  TRIPLANAR_DEBUG_TINTED,
  TRIPLANAR_DEBUG_WEIGHTS,
  type TerrainMesh,
  TerrainTextureArray,
  computeScreenSpaceInfo,
  controlmapStorageProperty,
  createTerrainColorNodeTriplanarNoTile,
  createTerrainRoughnessNodeTriplanarNoTile,
  distanceBasedSubdivision,
  screenSpaceSubdivision,
} from "@hello-terrain/three";
import { Environment, OrbitControls, useTexture } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  clamp,
  cross,
  dFdx,
  dFdy,
  float,
  fract,
  instanceIndex,
  int,
  normalize,
  positionWorld,
  select,
  sin,
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

// biome-ignore lint/suspicious/noExplicitAny: <idk its recommended way from drei>
extend(THREE as any);

const VERTEX_COUNT = 64;
const SEGMENT_COUNT = VERTEX_COUNT - 3;

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
  const [albedo, normal, height, roughness] = await Promise.all([
    loadImageData(`${basePath}-color.png`, targetSize),
    loadImageData(`${basePath}-normal.png`, targetSize),
    loadImageData(`${basePath}-height.png`, targetSize),
    loadImageData(`${basePath}-rough.png`, targetSize),
  ]);
  return { albedo, normal, height, roughness };
}

// Texture IDs (constants used in both CPU loading and GPU compute)
const TEXTURE_IDS = {
  grass: 0,
  rock: 1,
  slate: 2,
  snow: 3,
} as const;

// Control map debug modes (extend triplanar debug modes)
const CONTROL_DEBUG_OFF = 0; // Normal rendering
const CONTROL_DEBUG_BASE_TEXTURE = 10; // Visualize base texture ID
const CONTROL_DEBUG_OVERLAY_TEXTURE = 11; // Visualize overlay texture ID
const CONTROL_DEBUG_BLEND = 12; // Visualize blend factor
const CONTROL_DEBUG_SLOPE = 13; // Visualize slope (normal.y from varyings)
const CONTROL_DEBUG_ELEVATION = 14; // Visualize elevation
const CONTROL_DEBUG_GEOMETRIC_NORMAL = 15; // Visualize normal computed from screen-space derivatives

const TerrainPlane = () => {
  const { camera, gl } = useThree();
  const [terrain, setTerrain] = useState<TerrainMesh | null>(null);
  const [textureArray, setTextureArray] = useState<TerrainTextureArray | null>(
    null
  );

  const setMetric = useMetrics([
    "updatePosition",
    "heightmapComputeTime",
    "normalmapComputeTime",
    "controlmapComputeTime",
    "nodeCount",
    "deepestLevel",
    "hash",
    "hasStateChanged",
    "closestLeafIndex",
    "updateTime",
    "activeLeafCount",
  ] as const);

  const terrainGeometryControls = useControls("TerrainGeometry", {
    segments: {
      value: SEGMENT_COUNT,
      min: 2,
      max: 256 - 3,
      step: 2,
      label: "Segments",
    },
    maxLevel: {
      value: 10,
      min: 1,
      max: 32,
      step: 1,
      label: "Max Level",
    },
    rootSize: {
      value: 1024 * 17.3,
      min: 256,
      max: 1024 * 17.3,
      step: 64,
      label: "Root Size",
    },
    subdivisionMode: {
      value: "screenSpace" as "distance" | "screenSpace",
      options: ["distance", "screenSpace"],
      label: "LOD Mode",
    },
    subdivisionFactor: {
      value: 2,
      min: 0.1,
      max: 3,
      step: 0.1,
      label: "Distance Factor",
      render: (get) => get("TerrainGeometry.subdivisionMode") === "distance",
    },
    targetTrianglePixels: {
      value: 6,
      min: 2,
      max: 24,
      step: 1,
      label: "Target Triangle (px)",
      render: (get) => get("TerrainGeometry.subdivisionMode") === "screenSpace",
    },
    hysteresis: {
      value: 0.15,
      min: 0,
      max: 0.5,
      step: 0.01,
      label: "LOD Hysteresis",
    },
    minNodeSize: {
      value: SEGMENT_COUNT,
      min: 1,
      max: 256,
      step: 1,
      label: "Min Node Size",
    },
    heightmapScale: {
      value: 3861,
      min: 0.0,
      max: 5000,
      step: 1,
      label: "Heightmap Scale",
    },
  });

  const textureControls = useControls("Textures", {
    debugMode: {
      value: CONTROL_DEBUG_OFF,
      options: {
        Off: CONTROL_DEBUG_OFF,
        "Triplanar Weights": TRIPLANAR_DEBUG_WEIGHTS,
        "Triplanar Tinted": TRIPLANAR_DEBUG_TINTED,
        "Control: Base Texture": CONTROL_DEBUG_BASE_TEXTURE,
        "Control: Overlay Texture": CONTROL_DEBUG_OVERLAY_TEXTURE,
        "Control: Blend Factor": CONTROL_DEBUG_BLEND,
        "Control: Slope (vNormal)": CONTROL_DEBUG_SLOPE,
        "Control: Elevation": CONTROL_DEBUG_ELEVATION,
        "Control: Geometric Normal": CONTROL_DEBUG_GEOMETRIC_NORMAL,
      },
      label: "Debug Mode",
    },
    textureScale: {
      value: 50,
      min: 1,
      max: 200,
      step: 1,
      label: "Texture Scale",
    },
    triplanarSharpness: {
      value: 2,
      min: 1,
      max: 20,
      step: 0.5,
      label: "Triplanar Sharpness",
    },
    heightBlendSharpness: {
      value: 4,
      min: 1,
      max: 20,
      step: 0.5,
      label: "Blend Sharpness",
    },
    variationScale: {
      value: 0.01,
      min: 0.001,
      max: 1,
      step: 0.001,
      label: "Anti-Tile Scale",
    },
    transitionBlendWidth: {
      value: 0.3,
      min: 0.05,
      max: 0.5,
      step: 0.01,
      label: "Transition Blend",
    },
    slopeThreshold: {
      value: 60,
      min: 20,
      max: 85,
      step: 1,
      label: "Rock Slope (°)",
    },
    slopeBlendRange: {
      value: 10,
      min: 1,
      max: 30,
      step: 1,
      label: "Slope Blend (°)",
    },
    snowAltitude: {
      value: 2500,
      min: 500,
      max: 4000,
      step: 50,
      label: "Snow Altitude (m)",
    },
    snowBlendRange: {
      value: 300,
      min: 50,
      max: 1000,
      step: 50,
      label: "Snow Blend (m)",
    },
    snowSteepnessThreshold: {
      value: 45,
      min: 20,
      max: 75,
      step: 1,
      label: "Snow Max Slope (°)",
    },
  });

  const debugControls = useControls("Debug", {
    wireframe: {
      value: false,
      label: "Wireframe",
    },
    showTiles: {
      value: false,
      label: "Show Tiles",
    },
    frustumCulling: {
      value: true,
      label: "Frustum Culling",
    },
  });

  const performanceControls = useControls("Performance", {
    updateEveryNFrames: {
      value: 1,
      min: 1,
      max: 60,
      step: 1,
      label: "Update every N frames",
    },
  });

  const updateFrameCounter = useRef(0);

  // Screen-space info ref - updated each frame for LOD calculations
  const screenSpaceInfoRef = useRef<ScreenSpaceInfo | null>(null);

  // Create subdivision strategy based on selected mode
  const subdivisionStrategy: SubdivisionStrategy = useMemo(() => {
    if (terrainGeometryControls.subdivisionMode === "screenSpace") {
      return screenSpaceSubdivision({
        targetTrianglePixels: terrainGeometryControls.targetTrianglePixels,
        tileSegments: terrainGeometryControls.segments,
        hysteresis: terrainGeometryControls.hysteresis,
        getScreenSpaceInfo: () => screenSpaceInfoRef.current,
      });
    }
    return distanceBasedSubdivision(
      terrainGeometryControls.subdivisionFactor,
      terrainGeometryControls.hysteresis
    );
  }, [
    terrainGeometryControls.subdivisionMode,
    terrainGeometryControls.subdivisionFactor,
    terrainGeometryControls.targetTrianglePixels,
    terrainGeometryControls.segments,
    terrainGeometryControls.hysteresis,
  ]);

  // Load heightmap texture
  const heightmapTexture = useTexture("/assets/heightmaps/everest_h.png");

  // Configure heightmap texture for proper bilinear interpolation
  useEffect(() => {
    if (heightmapTexture) {
      heightmapTexture.minFilter = THREE.LinearFilter;
      heightmapTexture.magFilter = THREE.LinearFilter;
      heightmapTexture.wrapS = THREE.ClampToEdgeWrapping;
      heightmapTexture.wrapT = THREE.ClampToEdgeWrapping;
      heightmapTexture.needsUpdate = true;
    }
  }, [heightmapTexture]);

  // Load terrain textures on mount
  useEffect(() => {
    const loadTextures = async () => {
      // Create texture array
      const texArray = new TerrainTextureArray({
        resolution: 512,
        maxTextures: 32,
        generateMipmaps: true,
      });

      // Load all texture sets (resize to 512x512)
      const basePath = "/assets/terrain-textures";
      const textureResolution = 512;
      const [grass, rock, slate, snow] = await Promise.all([
        loadTextureSet(`${basePath}/grass/grass`, textureResolution),
        loadTextureSet(`${basePath}/rock/rock`, textureResolution),
        loadTextureSet(`${basePath}/slate/slate`, textureResolution),
        loadTextureSet(`${basePath}/snow/snow`, textureResolution),
      ]);

      // Add textures to array in order matching TEXTURE_IDS
      // grass = 0, rock = 1, slate = 2, snow = 3
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

      setTextureArray(texArray);
    };

    loadTextures().catch(console.error);
  }, []);

  // Elevation function that samples from the heightmap texture
  const elevationFn = useMemo(() => {
    return ElevationFn(({ worldPosition, rootSize }) => {
      // Map world position to UV coordinates [0, 1]
      // Center the terrain: worldPosition goes from -rootSize/2 to +rootSize/2
      const uv = vec2(
        worldPosition.x.div(rootSize).add(0.5),
        worldPosition.z.div(rootSize).add(0.5)
      );

      // Sample the heightmap texture - LinearFilter provides bilinear interpolation
      const heightSample = texture(heightmapTexture, uv);

      // Return raw height from red channel (0-1 range)
      // The TerrainMesh will apply heightmapScale via setHeightmapScale()
      return heightSample.r;
    });
  }, [heightmapTexture]);

  // Create uniforms for control function parameters (persisted across renders)
  // This avoids recreating the controlFn which causes heavy shader recompilation
  // biome-ignore lint/correctness/useExhaustiveDependencies: uniforms created once, values updated in useFrame
  const controlUniforms = useMemo(() => {
    // Convert initial slope threshold from degrees to cos(angle)
    const slopeThresholdCos = Math.cos(
      (textureControls.slopeThreshold * Math.PI) / 180
    );
    const slopeBlendCos = Math.cos(
      ((textureControls.slopeThreshold - textureControls.slopeBlendRange) *
        Math.PI) /
        180
    );
    const snowSteepnessThresholdCos = Math.cos(
      (textureControls.snowSteepnessThreshold * Math.PI) / 180
    );

    return {
      slopeThresholdCos: uniform(slopeThresholdCos),
      slopeBlendCos: uniform(slopeBlendCos),
      snowAltitude: uniform(textureControls.snowAltitude),
      snowBlendRange: uniform(textureControls.snowBlendRange),
      snowSteepnessThresholdCos: uniform(snowSteepnessThresholdCos),
      heightScale: uniform(terrainGeometryControls.heightmapScale),
    };
  }, []);

  // Control function that determines textures based on slope and altitude
  // Uses uniforms for dynamic values to avoid shader recompilation
  const controlFn = useMemo(() => {
    return ControlFn(({ height, normal }) => {
      // Scale height to world units (meters)
      const scaledHeight = height.mul(controlUniforms.heightScale);

      // Texture IDs
      const grassId = uint(TEXTURE_IDS.grass);
      const rockId = uint(TEXTURE_IDS.rock);
      const snowId = uint(TEXTURE_IDS.snow);

      // Calculate slope from normal.y
      // normal.y = 1 for flat ground, 0 for vertical surfaces
      // Steeper slopes have lower normal.y values
      const normalY = normal.y;

      // Compute smooth blend factors using smoothstep for better interpolation
      // Slope blend: 0 = flat (grass), 1 = steep (rock)
      // Use smoothstep for smooth S-curve interpolation
      const slopeRange = controlUniforms.slopeBlendCos.sub(
        controlUniforms.slopeThresholdCos
      );
      const slopeT = clamp(
        controlUniforms.slopeBlendCos.sub(normalY).div(slopeRange),
        0,
        1
      );
      const slopeBlendFactor = smoothstep(float(0), float(1), slopeT);

      // Snow blend: 0 = below snow line, 1 = above snow line
      // Blend smoothly over snowBlendRange with smoothstep
      const snowStart = controlUniforms.snowAltitude.sub(
        controlUniforms.snowBlendRange
      );
      const snowT = clamp(
        scaledHeight.sub(snowStart).div(controlUniforms.snowBlendRange),
        0,
        1
      );
      const snowBlendFactor = smoothstep(float(0), float(1), snowT);

      // Reduce snow on steep slopes (cliffs don't hold snow well)
      // Use a gentler threshold for snow reduction
      const snowSlopeThreshold = controlUniforms.slopeThresholdCos.mul(
        float(0.6)
      );
      const snowSlopeRange =
        controlUniforms.slopeBlendCos.sub(snowSlopeThreshold);
      const snowSlopeT = clamp(
        controlUniforms.slopeBlendCos.sub(normalY).div(snowSlopeRange),
        0,
        1
      );
      const snowSlopeReduction = smoothstep(float(0), float(1), snowSlopeT);
      const adjustedSnowBlend = snowBlendFactor.mul(
        float(1).sub(snowSlopeReduction)
      );

      // Determine which textures to blend based on conditions
      // Priority: Snow (at altitude) > Rock (steep) > Grass (flat, low)
      // Use smooth interpolation to avoid hard edges

      // Check if we're in a snow zone (significant snow contribution)
      const snowThreshold = float(0.15);
      const inSnowZone = adjustedSnowBlend.greaterThan(snowThreshold);

      // Check if slope is too steep for snow (independent threshold)
      const tooSteepForSnow = normalY.lessThan(
        controlUniforms.snowSteepnessThresholdCos
      );

      // Check if we're on a steep slope (for base texture selection)
      const steepThreshold = float(0.3);
      const isSteep = slopeBlendFactor.greaterThan(steepThreshold);

      // Base texture: rock if steep, grass if not steep (at all elevations)
      const baseTexture = select(isSteep, rockId, grassId);

      // Overlay texture: snow if in snow zone AND not too steep, otherwise same as base
      const canHaveSnow = inSnowZone.and(tooSteepForSnow.not());
      const overlayTexture = select(canHaveSnow, snowId, baseTexture);

      // Blend factor: only blend when snow is present and not too steep, otherwise no blend (0)
      const rawBlend = select(
        canHaveSnow,
        adjustedSnowBlend, // Snow zone and not too steep: blend based on snow amount
        float(0) // No snow or too steep: no blending (base texture only)
      );

      const blendFactor = clamp(rawBlend, 0, 1).mul(float(255));

      // UV scale (0 = 1x)
      const uvScale = uint(0);

      // Pack control data into uint32
      const packed = baseTexture
        .shiftLeft(uint(27))
        .bitOr(overlayTexture.shiftLeft(uint(22)))
        .bitOr(blendFactor.toUint().shiftLeft(uint(14)))
        .bitOr(uvScale.shiftLeft(uint(10)));

      return packed;
    });
  }, [controlUniforms]);

  // Set controlFn once when terrain is ready (not on every parameter change)
  useEffect(() => {
    if (terrain && controlFn) {
      terrain.controlFn = controlFn;
    }
  }, [terrain, controlFn]);

  const positionNode = useMemo(() => {
    if (!terrain) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return terrain.positionNode();
  }, [terrain]);

  // Create uniforms for texture controls (persisted across renders)
  // Values are updated in useFrame, so we intentionally don't include them as dependencies
  // biome-ignore lint/correctness/useExhaustiveDependencies: uniforms created once, values updated in useFrame
  const textureUniforms = useMemo(
    () => ({
      textureScale: uniform(textureControls.textureScale),
      heightBlendSharpness: uniform(textureControls.heightBlendSharpness),
      triplanarSharpness: uniform(textureControls.triplanarSharpness),
      debugMode: uniform(textureControls.debugMode),
      variationScale: uniform(textureControls.variationScale),
      transitionBlendWidth: uniform(textureControls.transitionBlendWidth),
      showTiles: uniform(0), // Initialized to 0, updated in useFrame
    }),
    []
  );

  const colorNode = useMemo(() => {
    if (!terrain || !textureArray) {
      return Fn(() => {
        return vec4(0.5, 0.5, 0.5, 1);
      })();
    }

    // Create the normal terrain color node (handles triplanar debug modes 0-2)
    const terrainColorNode = createTerrainColorNodeTriplanarNoTile({
      varyings: terrain.varyings,
      textureArray,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      textureScale: textureUniforms.textureScale as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      heightBlendSharpness: textureUniforms.heightBlendSharpness as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      triplanarSharpness: textureUniforms.triplanarSharpness as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      debugMode: textureUniforms.debugMode as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      variationScale: textureUniforms.variationScale as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      transitionBlendWidth: textureUniforms.transitionBlendWidth as any,
    });

    return Fn(() => {
      // Tile visualization: generate random color based on instance index
      const showTiles = textureUniforms.showTiles.equal(float(1));

      // Hash function to generate pseudo-random color from instance index
      const nodeIdx = float(instanceIndex);
      const hash1 = fract(
        sin(nodeIdx.mul(float(12.9898))).mul(float(43758.5453))
      );
      const hash2 = fract(
        sin(nodeIdx.mul(float(78.233))).mul(float(43758.5453))
      );
      const hash3 = fract(
        sin(nodeIdx.mul(float(37.719))).mul(float(43758.5453))
      );
      const tileColor = vec3(hash1, hash2, hash3);

      // Read control data from storage
      const globalVertexIndex = terrain.varyings.vGlobalVertexIndex;
      const packed = controlmapStorageProperty.element(globalVertexIndex);
      const packedInt = packed.toUint();

      // Decode control data
      const baseId = packedInt.shiftRight(int(27)).bitAnd(int(0x1f));
      const overlayId = packedInt.shiftRight(int(22)).bitAnd(int(0x1f));
      const blend = packedInt
        .shiftRight(int(14))
        .bitAnd(int(0xff))
        .toFloat()
        .div(255.0);

      // Define colors for each texture ID (matching TEXTURE_IDS)
      // grass=0 (green), rock=1 (brown), slate=2 (gray), snow=3 (white)
      const grassColor = vec3(0.2, 0.8, 0.2);
      const rockColor = vec3(0.6, 0.4, 0.2);
      const slateColor = vec3(0.5, 0.5, 0.55);
      const snowColor = vec3(0.95, 0.95, 1.0);

      // Map texture ID to color (simple lookup using select chain)
      const baseColor = select(
        baseId.equal(int(0)),
        grassColor,
        select(
          baseId.equal(int(1)),
          rockColor,
          select(baseId.equal(int(2)), slateColor, snowColor)
        )
      );

      const overlayColor = select(
        overlayId.equal(int(0)),
        grassColor,
        select(
          overlayId.equal(int(1)),
          rockColor,
          select(overlayId.equal(int(2)), slateColor, snowColor)
        )
      );

      // Blend factor as grayscale
      const blendColor = vec3(blend, blend, blend);

      // Slope visualization (normal.y from varyings: 1=flat/green, 0=vertical/red)
      const normalY = terrain.varyings.vNormal.y;
      const slopeColor = vec3(
        float(1).sub(normalY), // Red for steep
        normalY, // Green for flat
        float(0)
      );

      // Elevation visualization (vElevation grayscale, normalized to 0-1 range)
      // Assuming max height around 8000m for Everest heightmap
      const elevationNormalized = terrain.varyings.vElevation.div(float(8000));
      const elevationColor = vec3(
        elevationNormalized,
        elevationNormalized,
        elevationNormalized
      );

      // Geometric normal from screen-space derivatives of world position
      // This computes the actual surface normal at render time, independent of normalmap storage
      const worldPos = positionWorld;
      const dpdx = dFdx(worldPos);
      const dpdy = dFdy(worldPos);
      // Cross product order: cross(dpdx, dpdy) gives normal pointing "out" of surface
      const geometricNormal = normalize(cross(dpdx, dpdy));
      // Visualize: Y component (1=flat/green, 0=vertical/red)
      const geomNormalY = geometricNormal.y;
      const geometricNormalColor = vec3(
        float(1).sub(geomNormalY), // Red for steep
        geomNormalY, // Green for flat
        float(0)
      );

      // Select debug output based on mode
      // Modes 10-15 are control map debug modes
      const isControlBaseDebug = textureUniforms.debugMode.equal(
        float(CONTROL_DEBUG_BASE_TEXTURE)
      );
      const isControlOverlayDebug = textureUniforms.debugMode.equal(
        float(CONTROL_DEBUG_OVERLAY_TEXTURE)
      );
      const isControlBlendDebug = textureUniforms.debugMode.equal(
        float(CONTROL_DEBUG_BLEND)
      );
      const isControlSlopeDebug = textureUniforms.debugMode.equal(
        float(CONTROL_DEBUG_SLOPE)
      );
      const isControlElevationDebug = textureUniforms.debugMode.equal(
        float(CONTROL_DEBUG_ELEVATION)
      );
      const isControlGeometricNormalDebug = textureUniforms.debugMode.equal(
        float(CONTROL_DEBUG_GEOMETRIC_NORMAL)
      );
      const isControlDebug = isControlBaseDebug
        .or(isControlOverlayDebug)
        .or(isControlBlendDebug)
        .or(isControlSlopeDebug)
        .or(isControlElevationDebug)
        .or(isControlGeometricNormalDebug);

      // Select control debug color
      const controlDebugColor = select(
        isControlBaseDebug,
        baseColor,
        select(
          isControlOverlayDebug,
          overlayColor,
          select(
            isControlBlendDebug,
            blendColor,
            select(
              isControlSlopeDebug,
              slopeColor,
              select(
                isControlElevationDebug,
                elevationColor,
                geometricNormalColor
              )
            )
          )
        )
      );

      // Final output: prioritize tile visualization, then control debug, then terrain color
      const finalColor = select(
        showTiles,
        vec4(tileColor, float(1)),
        select(
          isControlDebug,
          vec4(controlDebugColor, float(1)),
          terrainColorNode
        )
      );

      return finalColor;
    })();
  }, [terrain, textureArray, textureUniforms]);

  const normalNode = useMemo(() => {
    if (!terrain) {
      return Fn(() => {
        return vec3(0, 1, 0);
      })();
    }
    // Transform object-space normals to view space for correct lighting
    // meshStandardNodeMaterial expects view-space normals for its PBR calculations
    return transformNormalToView(terrain.varyings.vNormal);
  }, [terrain]);

  const roughnessNode = useMemo(() => {
    if (!terrain || !textureArray) {
      return Fn(() => {
        return float(0.5);
      })();
    }

    return createTerrainRoughnessNodeTriplanarNoTile({
      varyings: terrain.varyings,
      textureArray,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      textureScale: textureUniforms.textureScale as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      triplanarSharpness: textureUniforms.triplanarSharpness as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      variationScale: textureUniforms.variationScale as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      transitionBlendWidth: textureUniforms.transitionBlendWidth as any,
    });
  }, [terrain, textureArray, textureUniforms]);

  useFrame(() => {
    if (!terrain) return;

    // Update heightmap scale from controls
    terrain.uniforms.setHeightmapScale(terrainGeometryControls.heightmapScale);

    // Update texture uniforms from controls (no shader recompilation needed)
    textureUniforms.textureScale.value = textureControls.textureScale;
    textureUniforms.heightBlendSharpness.value =
      textureControls.heightBlendSharpness;
    textureUniforms.triplanarSharpness.value =
      textureControls.triplanarSharpness;
    textureUniforms.debugMode.value = textureControls.debugMode;
    textureUniforms.variationScale.value = textureControls.variationScale;
    textureUniforms.transitionBlendWidth.value =
      textureControls.transitionBlendWidth;
    textureUniforms.showTiles.value = debugControls.showTiles ? 1 : 0;

    // Update control function uniforms (slope/altitude thresholds)
    // Convert slope angles from degrees to cos(angle) for GPU comparison
    const slopeThresholdCos = Math.cos(
      (textureControls.slopeThreshold * Math.PI) / 180
    );
    const slopeBlendCos = Math.cos(
      ((textureControls.slopeThreshold - textureControls.slopeBlendRange) *
        Math.PI) /
        180
    );
    const snowSteepnessThresholdCos = Math.cos(
      (textureControls.snowSteepnessThreshold * Math.PI) / 180
    );
    controlUniforms.slopeThresholdCos.value = slopeThresholdCos;
    controlUniforms.slopeBlendCos.value = slopeBlendCos;
    controlUniforms.snowAltitude.value = textureControls.snowAltitude;
    controlUniforms.snowBlendRange.value = textureControls.snowBlendRange;
    controlUniforms.snowSteepnessThresholdCos.value = snowSteepnessThresholdCos;
    controlUniforms.heightScale.value = terrainGeometryControls.heightmapScale;

    // Throttle quadtree/compute updates (expensive) to every N frames
    updateFrameCounter.current++;
    const n = performanceControls.updateEveryNFrames;
    if (n > 1 && updateFrameCounter.current % n !== 0) {
      return;
    }

    const renderer = gl as unknown as THREE.WebGPURenderer;
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);

    // Update screen-space info for LOD calculations
    // PerspectiveCamera.fov is in degrees, convert to radians
    if ("fov" in camera) {
      const fovRadians =
        ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
      const screenHeight = gl.domElement.height;
      screenSpaceInfoRef.current = computeScreenSpaceInfo(
        fovRadians,
        screenHeight
      );
    }

    terrain.update(renderer, camera.position, frustum);

    for (const [key, value] of Object.entries(terrain.metrics)) {
      if (typeof key === "string") {
        // biome-ignore lint/suspicious/noExplicitAny: metrics can be any type
        setMetric(key as any, String(value));
      }
    }
  });

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
        innerTileSegments={terrainGeometryControls.segments}
        elevationFn={elevationFn}
        controlFn={controlFn}
        frustumCulling={debugControls.frustumCulling}
        maxLevel={terrainGeometryControls.maxLevel}
        rootSize={terrainGeometryControls.rootSize}
        subdivisionStrategy={subdivisionStrategy}
        minNodeSize={terrainGeometryControls.minNodeSize}
      >
        <meshStandardNodeMaterial
          positionNode={positionNode}
          colorNode={colorNode}
          normalNode={normalNode}
          roughnessNode={roughnessNode}
          wireframe={debugControls.wireframe}
        />
      </hello.TerrainMesh>

      {/* Terrain-aware orbit controls that prevent camera from going below terrain */}
      <OrbitControls />

      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Environment preset="park" background={false} environmentIntensity={1} />
    </>
  );
};

export default function TexturedTerrainScene() {
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
          position: [300, 500, 500],
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
        <TerrainPlane />
      </Canvas>
    </div>
  );
}
