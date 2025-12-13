"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import * as hello from "@hello-terrain/react";
import {
  ControlFn,
  ElevationFn,
  type TerrainMesh,
  TerrainTextureArray,
  createTerrainColorNode,
} from "@hello-terrain/three";
import { OrbitControls, useTexture } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  float,
  min,
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
    textureScale: {
      value: 50,
      min: 1,
      max: 200,
      step: 1,
      label: "Texture Scale",
    },
    heightBlendSharpness: {
      value: 4,
      min: 1,
      max: 20,
      step: 0.5,
      label: "Blend Sharpness",
    },
    zone1Max: {
      value: 500,
      min: 0,
      max: 2000,
      step: 50,
      label: "Grass → Slate (m)",
    },
    zone2Max: {
      value: 1500,
      min: 500,
      max: 3000,
      step: 50,
      label: "Slate → Rock (m)",
    },
    zone3Max: {
      value: 2800,
      min: 1500,
      max: 4000,
      step: 50,
      label: "Rock → Snow (m)",
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

  // Control function that determines textures based on height
  // This runs in the compute shader after height/normal computation
  const controlFn = useMemo(() => {
    // Get zone thresholds from controls
    const z1 = textureControls.zone1Max;
    const z2 = textureControls.zone2Max;
    const z3 = textureControls.zone3Max;

    return ControlFn(({ height }) => {
      // Height thresholds from controls (in meters after scaling)
      // Note: height here is the raw computed height from the heightmap
      // The heightmapScale is applied in the vertex shader, so we need to
      // account for it here. Since elevationFn returns 0-1 and scale is 3861,
      // the height values here are 0-1 range, we multiply by scale.
      const scaledHeight = height.mul(
        float(terrainGeometryControls.heightmapScale)
      );

      // Zone thresholds as shader floats
      const zone1Max = float(z1);
      const zone2Max = float(z2);
      const zone3Max = float(z3);

      // Texture IDs as uint
      const grassId = uint(TEXTURE_IDS.grass);
      const rockId = uint(TEXTURE_IDS.rock);
      const slateId = uint(TEXTURE_IDS.slate);
      const snowId = uint(TEXTURE_IDS.snow);

      // Determine base and overlay textures based on height zones
      // Zone 1: < zone1Max - grass to slate
      // Zone 2: zone1Max to zone2Max - slate to rock
      // Zone 3: zone2Max to zone3Max - rock to snow
      // Zone 4: > zone3Max - pure snow

      const inZone1 = scaledHeight.lessThan(zone1Max);
      const inZone2 = scaledHeight
        .greaterThanEqual(zone1Max)
        .and(scaledHeight.lessThan(zone2Max));
      const inZone3 = scaledHeight
        .greaterThanEqual(zone2Max)
        .and(scaledHeight.lessThan(zone3Max));
      // Zone 4 is everything else (>= zone3Max)

      // Select base texture
      const baseTexture = select(
        inZone1,
        grassId,
        select(inZone2, slateId, select(inZone3, rockId, snowId))
      );

      // Select overlay texture
      const overlayTexture = select(
        inZone1,
        slateId,
        select(inZone2, rockId, select(inZone3, snowId, snowId))
      );

      // Calculate blend factor (0-255) within each zone
      // Zone widths for blend calculation
      const zone1Width = zone1Max;
      const zone2Width = zone2Max.sub(zone1Max);
      const zone3Width = zone3Max.sub(zone2Max);

      const blend1 = min(scaledHeight.div(zone1Width), float(1)).mul(
        float(255)
      );
      const blend2 = min(
        scaledHeight.sub(zone1Max).div(zone2Width),
        float(1)
      ).mul(float(255));
      const blend3 = min(
        scaledHeight.sub(zone2Max).div(zone3Width),
        float(1)
      ).mul(float(255));

      const blendFactor = select(
        inZone1,
        blend1,
        select(inZone2, blend2, select(inZone3, blend3, float(0)))
      );

      // UV scale (0 = 1x, stored as value - 1 in bits 13-10)
      const uvScale = uint(0);

      // Pack control data into uint32:
      // Bits 31-27: Base Texture ID (0-31)
      // Bits 26-22: Overlay Texture ID (0-31)
      // Bits 21-14: Blend Factor (0-255)
      // Bits 13-10: UV Scale (0-15)
      const packed = baseTexture
        .shiftLeft(uint(27))
        .bitOr(overlayTexture.shiftLeft(uint(22)))
        .bitOr(blendFactor.toUint().shiftLeft(uint(14)))
        .bitOr(uvScale.shiftLeft(uint(10)));

      return packed;
    });
  }, [
    terrainGeometryControls.heightmapScale,
    textureControls.zone1Max,
    textureControls.zone2Max,
    textureControls.zone3Max,
  ]);

  // Update terrain's controlFn when it changes
  // R3F's extend doesn't always detect function prop changes properly
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
    }),
    []
  );

  const colorNode = useMemo(() => {
    if (!terrain || !textureArray) {
      return Fn(() => {
        return vec4(0.5, 0.5, 0.5, 1);
      })();
    }

    return createTerrainColorNode({
      varyings: terrain.varyings,
      textureArray,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      textureScale: textureUniforms.textureScale as any,
      // biome-ignore lint/suspicious/noExplicitAny: uniform types are compatible at runtime
      heightBlendSharpness: textureUniforms.heightBlendSharpness as any,
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

      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
    </>
  );
};

export default function TexturedTerrainScene() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Canvas
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
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}
