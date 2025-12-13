"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import { TerrainOrbitControls } from "@/components/Terrain/TerrainOrbitControls";
import * as hello from "@hello-terrain/react";
import {
  ControlFn,
  ElevationFn,
  TRIPLANAR_DEBUG_OFF,
  TRIPLANAR_DEBUG_TINTED,
  TRIPLANAR_DEBUG_WEIGHTS,
  type TerrainMesh,
  TerrainTextureArray,
  createTerrainColorNodeTriplanarNoTile,
} from "@hello-terrain/three";
import { useTexture } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  clamp,
  float,
  select,
  texture,
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
    subdivisionFactor: {
      value: 2,
      min: 0.1,
      max: 3,
      step: 0.1,
      label: "Subdivision Factor",
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
      value: TRIPLANAR_DEBUG_OFF,
      options: {
        Off: TRIPLANAR_DEBUG_OFF,
        Weights: TRIPLANAR_DEBUG_WEIGHTS,
        Tinted: TRIPLANAR_DEBUG_TINTED,
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
  });

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

    return {
      slopeThresholdCos: uniform(slopeThresholdCos),
      slopeBlendCos: uniform(slopeBlendCos),
      snowAltitude: uniform(textureControls.snowAltitude),
      snowBlendRange: uniform(textureControls.snowBlendRange),
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

      // Slope blend: 0 = flat (grass), 1 = steep (rock)
      // When normal.y < slopeThresholdCos, it's steep (rock)
      // Blend smoothly between slopeBlendCos and slopeThresholdCos
      const slopeRange = controlUniforms.slopeBlendCos.sub(
        controlUniforms.slopeThresholdCos
      );
      const slopeBlendFactor = clamp(
        controlUniforms.slopeBlendCos.sub(normalY).div(slopeRange),
        0,
        1
      );

      // Snow blend: 0 = below snow line, 1 = above snow line
      // Blend smoothly over snowBlendRange
      const snowStart = controlUniforms.snowAltitude.sub(
        controlUniforms.snowBlendRange
      );
      const snowBlendFactor = clamp(
        scaledHeight.sub(snowStart).div(controlUniforms.snowBlendRange),
        0,
        1
      );

      // Determine textures based on slope and altitude:
      // Priority: Snow > Rock > Grass
      // - If steep slope: rock (even above snow line, cliffs don't hold snow)
      // - If above snow altitude (not steep): snow
      // - Otherwise: grass

      // For steep slopes, always use rock (cliffs don't hold snow well)
      const isSteep = normalY.lessThan(controlUniforms.slopeThresholdCos);
      const isSnowZone = scaledHeight.greaterThan(snowStart);

      // Base texture selection:
      // - Steep slopes: rock
      // - Snow zone (not steep): grass transitioning to snow
      // - Low altitude (not steep): grass
      const baseTexture = select(isSteep, rockId, grassId);

      // Overlay texture selection:
      // - Steep slopes: rock (no blend needed)
      // - Snow zone: snow (blending from grass to snow)
      // - Low altitude: grass with slight rock blend on moderate slopes
      const overlayTexture = select(
        isSteep,
        rockId,
        select(isSnowZone, snowId, rockId)
      );

      // Calculate blend factor (0-255)
      // For steep areas: blend based on slope (grass → rock)
      // For snow zone (non-steep): blend based on altitude (grass → snow)
      const rawBlend = select(
        isSteep,
        slopeBlendFactor, // Steep: blend grass to rock
        select(
          isSnowZone,
          snowBlendFactor, // Snow zone: blend to snow
          slopeBlendFactor // Low altitude: slight slope-based rock blend
        )
      );
      const blendFactor = rawBlend.mul(float(255));

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
    }),
    []
  );

  const colorNode = useMemo(() => {
    if (!terrain || !textureArray) {
      return Fn(() => {
        return vec4(0.5, 0.5, 0.5, 1);
      })();
    }

    // Use triplanar + stochastic tiling node for reduced texture repetition
    return createTerrainColorNodeTriplanarNoTile({
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
    });
  }, [terrain, textureArray, textureUniforms]);

  const normalNode = useMemo(() => {
    if (!terrain) {
      return Fn(() => {
        return vec3(0, 1, 0);
      })();
    }
    return terrain.varyings.vNormal;
  }, [terrain]);

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
    controlUniforms.slopeThresholdCos.value = slopeThresholdCos;
    controlUniforms.slopeBlendCos.value = slopeBlendCos;
    controlUniforms.snowAltitude.value = textureControls.snowAltitude;
    controlUniforms.snowBlendRange.value = textureControls.snowBlendRange;
    controlUniforms.heightScale.value = terrainGeometryControls.heightmapScale;

    const renderer = gl as unknown as THREE.WebGPURenderer;
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);

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
        maxLevel={terrainGeometryControls.maxLevel}
        rootSize={terrainGeometryControls.rootSize}
        subdivisionFactor={terrainGeometryControls.subdivisionFactor}
        minNodeSize={terrainGeometryControls.minNodeSize}
      >
        <meshStandardNodeMaterial
          positionNode={positionNode}
          colorNode={colorNode}
          normalNode={normalNode}
        />
      </hello.TerrainMesh>

      {/* Terrain-aware orbit controls that prevent camera from going below terrain */}
      <TerrainOrbitControls
        terrainMesh={terrain}
        target={[0, 50, 0]}
        minHeightAboveTerrain={10}
        heightAdjustmentSpeed={0.5}
      />

      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
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
