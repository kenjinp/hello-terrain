"use client";
import { useMetrics } from "@/components/Metrics/Metrics";
import {
  Environment,
  OrbitControls,
  useHelper,
  useTexture,
} from "@react-three/drei";
import {
  Canvas,
  type ThreeToJSXElements,
  extend,
  useFrame,
  useThree,
} from "@react-three/fiber";
import { useControls } from "leva";
import { easing } from "maath";
import { useCallback, useMemo, useRef } from "react";
import { Fn } from "three/src/nodes/TSL.js";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  dFdx,
  dFdy,
  float,
  instanceIndex,
  int,
  max,
  mix,
  positionLocal,
  positionWorld,
  pow,
  select,
  storage,
  texture,
  transformNormalToView,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { v4 as uuidv4 } from "uuid";
import { Skybox } from "./Skybox";
import { vec2_fbm, warp_fbm } from "./fmb";
import { HelloTerrain, useHelloTerrain } from "./lib/HelloTerrain/HelloTerrain";
import { blendNormalsRNM } from "./lib/TSLNodes/Normals";
import { createTriplanarTextureBlend } from "./lib/TSLNodes/Textures";

declare module "@react-three/fiber" {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

// biome-ignore lint/suspicious/noExplicitAny: <idk its recommended way from drei>
extend(THREE as any);

const cameraHeightVector = new THREE.Vector3(0, 0, 0);
const tempCameraHeightBuffer = new Float32Array(1);

const ROOT_SIZE_M = 256_000;

const PLANE_EDGE_VERTEX_COUNT = 64 + 1;
const PLANE_SIZE = PLANE_EDGE_VERTEX_COUNT * PLANE_EDGE_VERTEX_COUNT;

// TerrainMaterial component that uses the HelloTerrain context
const TerrainMaterial = () => {
  const { quadTree, mesh } = useHelloTerrain();
  const { gl } = useThree();
  const lastHash = useRef<number>(0);

  const dirLight = useRef<THREE.DirectionalLight>(null);
  const cameraLight = useRef<THREE.PointLight>(null);

  const setMetric = useMetrics([
    "computeTime",
    "quadtreeResolutionTime",
    "leafNodeCount",
    "deepestLevel",
    "cameraAltitude",
    "terrainHeight",
    "hashTime",
    "hash",
    "hasStateChanged",
  ] as const);

  const quadtreeControls = useControls("Texture Settings", {
    lightPosition: {
      value: { x: 10, y: 10, z: 20 },
    },
    maxLevel: {
      value: 16,
      min: 1,
      max: 32,
      step: 1,
      label: "Max Level",
    },
    maxNodes: {
      value: 2000,
      min: 100,
      max: 10000,
      step: 100,
      label: "Max Nodes",
    },
    showLightHelper: {
      value: false,
    },
    rootSize: {
      value: ROOT_SIZE_M,
      min: 256,
      max: ROOT_SIZE_M * 2,
      step: 100,
      label: "Root Size",
    },
    minNodeSize: {
      value: PLANE_EDGE_VERTEX_COUNT + 1,
      min: 16,
      max: 1024,
      step: 10,
      label: "Min Node Size",
    },
    subdivisionFactor: {
      value: 1.5,
      min: 0.5,
      max: 3.0,
      step: 0.1,
      label: "Subdivision Factor",
    },
    skirtLength: {
      value: 1000,
      min: 0,
      max: 10000,
      step: 1,
      label: "Skirt Length",
    },
    heightmapScale: {
      value: 8000,
      min: 0.0,
      max: 10000.0,
      step: 1000.0,
      label: "Heightmap Scale",
    },
    fbmIterations: {
      value: 12,
      min: 1,
      max: 30,
      step: 1,
      label: "FBM Iterations",
    },
    fbmAmplitude: {
      value: 8,
      min: 0.0,
      max: 10.0,
      step: 0.1,
      label: "FBM Amplitude",
    },
    fbmFrequency: {
      value: 2.4,
      min: 0.0,
      max: 10.0,
      step: 0.1,
      label: "FBM Frequency",
    },
    fbmLacunarity: {
      value: 0.4,
      min: 0.0,
      max: 10.0,
      step: 0.1,
      label: "FBM Lacunarity",
    },
    fbmPersistence: {
      value: 0.85,
      min: 0.0,
      max: 1.0,
      step: 0.01,
      label: "FBM Persistence",
    },
    delta: {
      value: 0.5,
      min: 0.0,
      max: 10.0,
      step: 0.01,
      label: "Delta",
    },
    textureScale: {
      value: 0.1,
      min: 0.0,
      max: 1.0,
      step: 0.01,
      label: "Texture Scale",
    },
    contrast: {
      value: 1.0,
      min: 0.1,
      max: 10.0,
      step: 0.1,
      label: "Texture Contrast",
    },
    slopeTransitionStart: {
      value: 0.18,
      min: 0.0,
      max: 1.0,
      step: 0.01,
      label: "Slope Transition Start",
    },
    slopeTransitionEnd: {
      value: 0.25,
      min: 0.0,
      max: 1.0,
      step: 0.01,
      label: "Slope Transition End",
    },
    // Distance-based normal blending controls
    enableDistanceBlending: {
      value: true,
      label: "Enable Distance Normal Blending",
    },
    distanceBlendStart: {
      value: 1000,
      min: 0,
      max: 10000,
      step: 100,
      label: "Distance Blend Start (m)",
    },
    distanceBlendEnd: {
      value: 5000,
      min: 0,
      max: 20000,
      step: 100,
      label: "Distance Blend End (m)",
    },
    distanceBlendStrength: {
      value: 1.0,
      min: 0.0,
      max: 2.0,
      step: 0.1,
      label: "Distance Blend Strength",
    },
    // LOD controls
    lodBias: {
      value: 0.0,
      min: -4.0,
      max: 4.0,
      step: 0.1,
      label: "LOD Bias",
    },
    lodScale: {
      value: 0.5,
      min: 0.1,
      max: 2.0,
      step: 0.1,
      label: "LOD Scale",
    },
  });
  const lightPositionVec = useMemo(
    () =>
      new THREE.Vector3(
        quadtreeControls.lightPosition.x,
        quadtreeControls.lightPosition.y,
        quadtreeControls.lightPosition.z
      ),
    [quadtreeControls.lightPosition]
  );
  const { showLightHelper } = quadtreeControls;
  useHelper(
    // @ts-ignore
    showLightHelper ? dirLight : null,
    THREE.DirectionalLightHelper,
    1,
    "blue"
  );
  const terrainHeightRef = useRef(0);

  // Unused textures - commented out to suppress TypeScript warnings
  // const uvTexture = useTexture("/assets/uv.png");
  // const normalMap = useTexture("/assets/heightmaps/normal-test.png");
  // const baseNormal = useTexture("/assets/base_160.png");
  // const detailNormal = useTexture("/assets/detail_160.png");

  const [grassDiffuse, grassNormal, grassHeight, grassRoughness] = useTexture(
    [
      "/assets/terrain-textures/grass/grass-color.png",
      "/assets/terrain-textures/grass/grass-normal.png",
      "/assets/terrain-textures/grass/grass-height.png",
      "/assets/terrain-textures/grass/grass-rough.png",
    ],
    (textures) => {
      for (const texture of textures) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // Enable mipmaps for better performance and quality
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        // For WebGPU, ensure proper texture format
        texture.format = THREE.RGBAFormat;
        texture.type = THREE.UnsignedByteType;
        // Advanced mipmap settings
        texture.anisotropy = 16; // Improve texture quality at angles
        texture.flipY = false; // WebGPU typically doesn't flip textures
      }
    }
  );

  const [cliffDiffuse, cliffNormal, cliffHeight, cliffRoughness] = useTexture(
    [
      "/assets/terrain-textures/slate/slate-color.png",
      "/assets/terrain-textures/slate/slate-normal.png",
      "/assets/terrain-textures/slate/slate-height.png",
      "/assets/terrain-textures/slate/slate-rough.png",
    ],
    (textures) => {
      for (const texture of textures) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // Enable mipmaps for better performance and quality
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        // For WebGPU, ensure proper texture format
        texture.format = THREE.RGBAFormat;
        texture.type = THREE.UnsignedByteType;
        // Advanced mipmap settings
        texture.anisotropy = 16; // Improve texture quality at angles
        texture.flipY = false; // WebGPU typically doesn't flip textures
      }
    }
  );

  // Create compute shader nodes for matrix updates
  const shaderData = useMemo(() => {
    const cameraHeightBuffer = new THREE.StorageInstancedBufferAttribute(
      new Float32Array(1).fill(0),
      1
    );
    const cameraPositionHeight = storage(cameraHeightBuffer, "f32", 1);
    const cameraPositionUniform = uniform(vec3(0, 0, 0)).label(
      "uCameraPosition"
    );
    const vNormal = varying(vec3(), "vNormal");
    const vPosition = varying(vec3(), "vPosition");
    const vWorldUv = varying(vec2(), "vWorldUv");

    // Create uniforms for all control values
    const deltaUniform = uniform(0.1).label("delta");
    const fbmIterationsUniform = uniform(12).label("fbmIterations");
    const fbmAmplitudeUniform = uniform(8).label("fbmAmplitude");
    const fbmFrequencyUniform = uniform(2).label("fbmFrequency");
    const fbmLacunarityUniform = uniform(0.4).label("fbmLacunarity");
    const fbmPersistenceUniform = uniform(0.85).label("fbmPersistence");

    const colorUniform = uniform(vec3(1, 1, 1)).label("myColorUniform");
    const timeUniform = uniform(0).label("myTimeUniform");
    const { nodeBuffer, leafNodeMask } = quadTree
      ?.getNodeView()
      .getBuffers() ?? {
      nodeBuffer: new Float32Array(),
      leafNodeMask: new Uint32Array(),
    };
    const rootOriginUniform = uniform(vec3(0, 0, 0)).label("rootOrigin");
    const skirtLengthUniform = uniform(0).label("skirtLength");
    const rootSizeUniform = uniform(1024 * PLANE_SIZE).label("rootSize");
    const heightmapScaleUniform = uniform(100000).label("heightmapScale");
    const nodeStorageBufferAttribute =
      new THREE.StorageInstancedBufferAttribute(nodeBuffer, 4);
    const leafNodeMaskStorageBufferAttribute =
      new THREE.StorageInstancedBufferAttribute(leafNodeMask, 1);

    // const lod = int(8); // Unused variable
    const bias = int(1);

    const textureScaleUniform = uniform(0.01).label("textureScale");
    const contrastUniform = uniform(1.0).label("contrast");
    const slopeTransitionStartUniform = uniform(0.18).label(
      "slopeTransitionStart"
    );
    const slopeTransitionEndUniform = uniform(0.25).label("slopeTransitionEnd");

    // Distance-based normal blending uniforms
    const enableDistanceBlendingUniform = uniform(1).label(
      "enableDistanceBlending"
    );
    const distanceBlendStartUniform = uniform(1000).label("distanceBlendStart");
    const distanceBlendEndUniform = uniform(5000).label("distanceBlendEnd");
    const distanceBlendStrengthUniform = uniform(1.0).label(
      "distanceBlendStrength"
    );

    // LOD control uniforms
    const lodBiasUniform = uniform(0.0).label("lodBias");
    const lodScaleUniform = uniform(0.5).label("lodScale");

    // Helper function to calculate LOD level based on texture coordinate derivatives
    const calculateLODLevel = Fn(
      ({
        worldPosition,
      }: {
        worldPosition: THREE.TSL.ShaderNodeObject<THREE.Node>;
      }) => {
        // Calculate texture coordinate derivatives for LOD
        const textureCoordX = worldPosition.xz.mul(textureScaleUniform);
        const textureCoordY = worldPosition.yx.mul(textureScaleUniform);
        const textureCoordZ = worldPosition.zy.mul(textureScaleUniform);

        // Calculate derivatives of texture coordinates
        const dx = dFdx(textureCoordX);
        const dy = dFdy(textureCoordX);
        const dx2 = dFdx(textureCoordY);
        const dy2 = dFdy(textureCoordY);
        const dx3 = dFdx(textureCoordZ);
        const dy3 = dFdy(textureCoordZ);

        // Calculate maximum derivative length for each texture coordinate set
        const maxDerivX = max(dx.lengthSq(), dy.lengthSq());
        const maxDerivY = max(dx2.lengthSq(), dy2.lengthSq());
        const maxDerivZ = max(dx3.lengthSq(), dy3.lengthSq());

        // Use the maximum derivative to determine LOD level
        const maxDeriv = max(maxDerivX, max(maxDerivY, maxDerivZ));
        const lodLevel = maxDeriv.log2().mul(0.5);

        // Apply user-controlled bias and scale
        return lodLevel.add(lodBiasUniform).mul(lodScaleUniform);
      }
    );

    const nodeStorage = storage(
      nodeStorageBufferAttribute,
      "i32",
      quadtreeControls.maxNodes * 4
    ); // 4 integers per node
    const leafNodeMaskStorage = storage(
      leafNodeMaskStorageBufferAttribute,
      "u32",
      quadtreeControls.maxNodes
    );

    const elevationAtWorldPosition = Fn(
      ({
        worldPosition,
      }: {
        worldPosition: THREE.TSL.ShaderNodeObject<
          THREE.ConstNode<THREE.Vector3>
        >;
      }) => {
        const worldUV = vec2(
          worldPosition.x.div(rootSizeUniform).add(0.5),
          worldPosition.z.div(rootSizeUniform).mul(-1.0).add(0.5)
        );

        const warpStrength = float(0.5);
        const baseStrength = float(1);
        const warpFbm = warp_fbm({
          position: worldUV,
        });
        const fbm = vec2_fbm(
          worldUV,
          fbmIterationsUniform,
          fbmAmplitudeUniform,
          fbmFrequencyUniform,
          fbmLacunarityUniform,
          fbmPersistenceUniform
        );
        const noise = warpStrength.mul(warpFbm).add(baseStrength.mul(fbm));
        // const voronoiUV = vec2_fbm(
        //   worldUV,
        //   float(8),
        //   float(1),
        //   float(2.4),
        //   float(0.4),
        //   float(0.85),
        // ).xy.mix(worldUV, 0.95);
        // const voronoiUV2 = vec2_fbm(
        //   voronoiUV,
        //   float(5),
        //   float(1),
        //   float(2),
        //   float(0.4),
        //   float(0.85),
        // ).xy.mix(voronoiUV, 0.6);
        // const voronoi = voronoiCells({
        //   scale: 100,
        //   facet: 0,
        //   seed: 0,
        //   uv: voronoiUV2,
        // });

        const height = noise;
        const heightmapMinElevation = 0;
        const heightmapMaxElevation = 1;
        const remappedHeight = height
          .remap(heightmapMinElevation, heightmapMaxElevation, 0, 1)
          .mul(heightmapScaleUniform);
        return remappedHeight;
      }
    );

    const vertexPositions = Fn(() => {
      const nodeIndex = instanceIndex;
      const nodeOffset = nodeIndex.mul(int(4));
      const level = nodeStorage.element(nodeOffset);
      const nodeX = nodeStorage.element(nodeOffset.add(int(1)));
      const nodeY = nodeStorage.element(nodeOffset.add(int(2)));
      const isLeaf = nodeStorage.element(nodeOffset.add(int(3))).equal(int(1));

      // // Compute world-space position centred so that the entire root tile spans [-rootSize/2, rootSize/2]
      const tileSize = rootSizeUniform.div(pow(2.0, level.toFloat()));
      const worldX = rootOriginUniform.x.add(
        nodeX.add(0.5).mul(tileSize).sub(rootSizeUniform.div(2.0))
      );
      const worldZ = rootOriginUniform.z.add(
        nodeY.add(0.5).mul(tileSize).sub(rootSizeUniform.div(2.0))
      );

      const isOnEdge = uv()
        .x.greaterThan(0.9999)
        .or(uv().x.lessThan(0.0001))
        .or(uv().y.greaterThan(0.9999))
        .or(uv().y.lessThan(0.0001));

      const scaleFromSkirt = float(
        (PLANE_EDGE_VERTEX_COUNT + 2) / PLANE_EDGE_VERTEX_COUNT
      );

      const positionWithHeight = Fn(() => {
        const scaledLocalX = positionLocal.x.mul(tileSize.mul(scaleFromSkirt));
        const scaledLocalZ = positionLocal.y.mul(tileSize.mul(scaleFromSkirt));
        const finalWorldX = worldX.add(scaledLocalX);
        const finalWorldZ = worldZ.sub(scaledLocalZ);
        const remappedHeight = elevationAtWorldPosition({
          worldPosition: vec3(finalWorldX, 0, finalWorldZ),
        });

        const position = vec3(finalWorldX, remappedHeight, finalWorldZ).toVar();

        // Calculate tangent and bitangent using finite differences
        const worldPositionDistanceBetweenVectors = tileSize
          .mul(scaleFromSkirt)
          .div(PLANE_EDGE_VERTEX_COUNT)
          .mul(deltaUniform);

        const heightXPlus = elevationAtWorldPosition({
          worldPosition: vec3(
            finalWorldX.add(worldPositionDistanceBetweenVectors),
            0,
            finalWorldZ
          ),
        });

        const heightXMinus = elevationAtWorldPosition({
          worldPosition: vec3(
            finalWorldX.sub(worldPositionDistanceBetweenVectors),
            0,
            finalWorldZ
          ),
        });

        const heightZPlus = elevationAtWorldPosition({
          worldPosition: vec3(
            finalWorldX,
            0,
            finalWorldZ.add(worldPositionDistanceBetweenVectors)
          ),
        });

        const heightZMinus = elevationAtWorldPosition({
          worldPosition: vec3(
            finalWorldX,
            0,
            finalWorldZ.sub(worldPositionDistanceBetweenVectors)
          ),
        });

        const worldUV = vec2(
          position.x.div(rootSizeUniform).add(0.5),
          position.z.div(rootSizeUniform).mul(-1.0).add(0.5)
        );
        vWorldUv.assign(worldUV);

        // (height at +1 minus height at -1) / (horizontal distance between +1 and -1)
        const xDerivate = heightXPlus
          .sub(heightXMinus)
          .div(worldPositionDistanceBetweenVectors);
        const zDerivate = heightZPlus
          .sub(heightZMinus)
          .div(worldPositionDistanceBetweenVectors);
        const normal = vec3(
          xDerivate.negate(),
          1.0,
          zDerivate.negate()
        ).normalize();
        vNormal.assign(normal);

        return position;
      });

      const skirt = Fn(() => {
        const pos = positionWithHeight();
        const worldUV = vec2(
          positionWorld.x.div(rootSizeUniform).add(0.5),
          positionWorld.z.div(rootSizeUniform).mul(-1.0).add(0.5)
        );
        vWorldUv.assign(worldUV);
        // Set normal to point downward for skirt vertices
        return vec3(pos.x, pos.y.sub(skirtLengthUniform.value), pos.z);
      });

      vPosition.assign(
        select(
          isLeaf.not(),
          vec3(0.0, 0.0, 0.0),
          select(isOnEdge, skirt(), positionWithHeight())
        )
      );

      return vPosition;
    });

    const computeHeightAtCameraPosition = Fn(() => {
      const height = elevationAtWorldPosition({
        worldPosition: cameraPositionUniform,
      });
      cameraPositionHeight.element(0).assign(height);
    })().compute(1, [1]);

    const positionNode = vertexPositions();

    const normalNodeCalc = Fn(() => {
      const worldPosition = vPosition.toVar();
      const normal = vNormal.toVar();

      const lodLevel = calculateLODLevel({ worldPosition });

      const grassNormalTexture = texture(grassNormal, null, lodLevel, bias);
      grassNormalTexture.y.assign(grassNormalTexture.y.negate());
      const cliffNormalTexture = texture(cliffNormal, null, lodLevel, bias);
      cliffNormalTexture.y.assign(cliffNormalTexture.y.negate());
      const grassHeightTexture = texture(grassHeight, null, lodLevel, bias);
      const cliffHeightTexture = texture(cliffHeight, null, lodLevel, bias);

      const heightBlendedTexture = createTriplanarTextureBlend(
        grassNormalTexture,
        cliffNormalTexture,
        grassHeightTexture,
        cliffHeightTexture,
        textureScaleUniform,
        worldPosition,
        normal,
        slopeTransitionStartUniform,
        slopeTransitionEndUniform,
        contrastUniform
      );

      // Calculate distance from camera to vertex
      const distanceToCamera = worldPosition
        .sub(cameraPositionUniform)
        .length();

      // Calculate distance-based blend factor
      const blendStart = distanceBlendStartUniform;
      const blendEnd = distanceBlendEndUniform;
      const blendStrength = distanceBlendStrengthUniform;

      // Smoothstep from blendStart to blendEnd
      const normalizedDistance = distanceToCamera
        .sub(blendStart)
        .div(blendEnd.sub(blendStart));
      const smoothBlend = normalizedDistance
        .clamp(0.0, 1.0)
        .smoothstep(0.0, 1.0);

      // Apply strength multiplier and enable/disable blending
      const distanceBlendFactor = smoothBlend
        .mul(blendStrength)
        .mul(enableDistanceBlendingUniform)
        .clamp(0.0, 1.0);

      // Blend between terrain geometry normal and texture normal based on distance
      const terrainGeometryNormal = normal;
      const textureNormal = blendNormalsRNM(heightBlendedTexture, normal);

      // Linear interpolation between terrain normal and texture normal
      // const finalNormal = terrainGeometryNormal
      //   .mul(distanceBlendFactor.oneMinus())
      //   .add(textureNormal.mul(distanceBlendFactor))
      //   .normalize();
      const finalNormal = mix(
        terrainGeometryNormal,
        textureNormal,
        distanceBlendFactor.oneMinus()
      );

      return finalNormal;
    })();

    const normalNode = transformNormalToView(normalNodeCalc);

    const colorNode = Fn(() => {
      const worldPosition = vPosition.toVar();
      const normal = vNormal.toVar();

      const lodLevel = calculateLODLevel({ worldPosition });

      return createTriplanarTextureBlend(
        texture(grassDiffuse, null, lodLevel, bias),
        texture(cliffDiffuse, null, lodLevel, bias),
        texture(grassHeight, null, lodLevel, bias),
        texture(cliffHeight, null, lodLevel, bias),
        textureScaleUniform,
        worldPosition,
        normal,
        slopeTransitionStartUniform,
        slopeTransitionEndUniform,
        contrastUniform
      );
    })();

    const roughnessNode = Fn(() => {
      const worldPosition = vPosition.toVar();
      const normal = vNormal.toVar();

      const lodLevel = calculateLODLevel({ worldPosition });

      return createTriplanarTextureBlend(
        texture(grassRoughness, null, lodLevel, bias),
        texture(cliffRoughness, null, lodLevel, bias),
        texture(grassHeight, null, lodLevel, bias),
        texture(cliffHeight, null, lodLevel, bias),
        textureScaleUniform,
        worldPosition,
        normal,
        slopeTransitionStartUniform,
        slopeTransitionEndUniform,
        contrastUniform
      );
    })();

    return {
      positionNode,
      rootSizeUniform,
      rootOriginUniform,
      leafNodeMaskStorage,
      nodeStorage,
      colorNode,
      nodeStorageBufferAttribute,
      leafNodeMaskStorageBufferAttribute,
      normalNode,
      heightmapScaleUniform,
      colorUniform,
      timeUniform,
      skirtLengthUniform,
      computeHeightAtCameraPosition,
      cameraHeightBuffer,
      cameraPositionUniform,
      fbmIterationsUniform,
      fbmAmplitudeUniform,
      fbmFrequencyUniform,
      fbmLacunarityUniform,
      fbmPersistenceUniform,
      deltaUniform,
      textureScaleUniform,
      contrastUniform,
      slopeTransitionStartUniform,
      slopeTransitionEndUniform,
      roughnessNode,
      // Distance blending uniforms
      enableDistanceBlendingUniform,
      distanceBlendStartUniform,
      distanceBlendEndUniform,
      distanceBlendStrengthUniform,
      // LOD control uniforms
      lodBiasUniform,
      lodScaleUniform,
    };
  }, [
    grassDiffuse,
    grassNormal,
    grassHeight,
    grassRoughness,
    cliffDiffuse,
    cliffNormal,
    cliffHeight,
    cliffRoughness,
    quadtreeControls.maxNodes,
    quadTree,
  ]);

  const compute = useCallback(async () => {
    const gpu = gl as unknown as THREE.WebGPURenderer;
    try {
      const before = performance.now();
      await gpu.computeAsync(shaderData.computeHeightAtCameraPosition);
      const heightBuffer = await gpu.getArrayBufferAsync(
        shaderData.cameraHeightBuffer
      );
      const after = performance.now();
      setMetric("computeTime", `${(after - before).toFixed(2)}ms`);
      const dataView = new DataView(heightBuffer);
      tempCameraHeightBuffer[0] = dataView.getFloat32(0, true); // true for little-endian
      return tempCameraHeightBuffer[0];
    } catch (error) {
      console.error("Error in compute shader:", error);
    }
    return 0;
  }, [
    shaderData.computeHeightAtCameraPosition,
    gl,
    shaderData.cameraHeightBuffer,
    setMetric,
  ]);

  useFrame(async (state, delta) => {
    const { clock, camera } = state;
    if (shaderData.timeUniform) {
      shaderData.timeUniform.value = clock.getElapsedTime();
    }
    if (!quadTree) return;
    shaderData.cameraPositionUniform.value = camera.position;

    const terrainHeight = await compute();
    terrainHeightRef.current = terrainHeight;
    cameraHeightVector.copy(camera.position);
    // offset the camera height by the terrain height
    // so we can resolve the quadtree correctly
    cameraHeightVector.y = camera.position.y - terrainHeight;

    const beforeUpdate = performance.now();
    // quadTree.update(cameraHeightVector);
    const afterUpdate = performance.now();
    setMetric(
      "quadtreeResolutionTime",
      `${(afterUpdate - beforeUpdate).toFixed(2)}ms`
    );

    const nodeCount = quadTree.getNodeCount();
    const leafNodeCount = quadTree.getLeafNodeCount();

    setMetric("leafNodeCount", `leaf ${leafNodeCount} / ${nodeCount}`);

    const currentDeepestLevel = quadTree.getDeepestLevel();

    setMetric("deepestLevel", currentDeepestLevel.toString());

    // Update uniforms
    if (shaderData.rootSizeUniform) {
      shaderData.rootSizeUniform.value = quadtreeControls.rootSize;
    }

    if (shaderData.skirtLengthUniform) {
      shaderData.skirtLengthUniform.value = quadtreeControls.skirtLength;
    }

    if (shaderData.heightmapScaleUniform) {
      shaderData.heightmapScaleUniform.value = quadtreeControls.heightmapScale;
    }

    // Update FBM uniforms
    if (shaderData.fbmIterationsUniform) {
      shaderData.fbmIterationsUniform.value = quadtreeControls.fbmIterations;
    }
    if (shaderData.fbmAmplitudeUniform) {
      shaderData.fbmAmplitudeUniform.value = quadtreeControls.fbmAmplitude;
    }
    if (shaderData.fbmFrequencyUniform) {
      shaderData.fbmFrequencyUniform.value = quadtreeControls.fbmFrequency;
    }
    if (shaderData.fbmLacunarityUniform) {
      shaderData.fbmLacunarityUniform.value = quadtreeControls.fbmLacunarity;
    }
    if (shaderData.fbmPersistenceUniform) {
      shaderData.fbmPersistenceUniform.value = quadtreeControls.fbmPersistence;
    }
    if (shaderData.deltaUniform) {
      shaderData.deltaUniform.value = quadtreeControls.delta;
    }

    // Update buffers with latest quadtree data
    const { nodeBuffer, leafNodeMask } = quadTree.getNodeView().getBuffers();
    shaderData.nodeStorageBufferAttribute.array.set(nodeBuffer);
    shaderData.leafNodeMaskStorageBufferAttribute.array.set(leafNodeMask);
    shaderData.nodeStorageBufferAttribute.needsUpdate = true;
    shaderData.leafNodeMaskStorageBufferAttribute.needsUpdate = true;

    setMetric(
      "cameraAltitude",
      `${(camera.position.y - terrainHeight).toFixed(2)}m`
    );

    setMetric("terrainHeight", `${terrainHeight.toFixed(2)}m`);

    if (dirLight.current) {
      easing.damp3(
        dirLight.current.position,
        lightPositionVec.normalize(),
        0.001,
        delta
      );
    }

    // Update camera light position to follow camera
    if (cameraLight.current) {
      cameraLight.current.position.copy(camera.position);
    }

    if (shaderData.textureScaleUniform) {
      shaderData.textureScaleUniform.value = quadtreeControls.textureScale;
    }
    if (shaderData.contrastUniform) {
      shaderData.contrastUniform.value = quadtreeControls.contrast;
    }
    if (shaderData.slopeTransitionStartUniform) {
      shaderData.slopeTransitionStartUniform.value =
        quadtreeControls.slopeTransitionStart;
    }
    if (shaderData.slopeTransitionEndUniform) {
      shaderData.slopeTransitionEndUniform.value =
        quadtreeControls.slopeTransitionEnd;
    }

    // Update distance blending uniforms
    if (shaderData.enableDistanceBlendingUniform) {
      shaderData.enableDistanceBlendingUniform.value =
        quadtreeControls.enableDistanceBlending ? 1 : 0;
    }
    if (shaderData.distanceBlendStartUniform) {
      shaderData.distanceBlendStartUniform.value =
        quadtreeControls.distanceBlendStart;
    }
    if (shaderData.distanceBlendEndUniform) {
      shaderData.distanceBlendEndUniform.value =
        quadtreeControls.distanceBlendEnd;
    }
    if (shaderData.distanceBlendStrengthUniform) {
      shaderData.distanceBlendStrengthUniform.value =
        quadtreeControls.distanceBlendStrength;
    }

    // Update LOD control uniforms
    if (shaderData.lodBiasUniform) {
      shaderData.lodBiasUniform.value = quadtreeControls.lodBias;
    }
    if (shaderData.lodScaleUniform) {
      shaderData.lodScaleUniform.value = quadtreeControls.lodScale;
    }

    if (quadTree.hasStateChanged(lastHash.current)) {
      const beforeHash = performance.now();
      lastHash.current = quadTree.getStateHash();
      const afterHash = performance.now();
      setMetric("hashTime", `${(afterHash - beforeHash).toFixed(2)}ms`);
      setMetric("hash", lastHash.current.toString());
      if (mesh) {
        mesh.instanceMatrix.needsUpdate = true;
      }
      setMetric("hasStateChanged", "true");
    } else {
      setMetric("hasStateChanged", "false");
    }
  });

  return (
    <>
      {/* <FlyCamera height={terrainHeightRef} minSpeed={100} /> */}

      <mesh position={[0, 20000, 0]} receiveShadow castShadow>
        <sphereGeometry args={[10000, 32, 32]} />
        <meshStandardMaterial color="red" />
      </mesh>
      <meshPhysicalNodeMaterial
        key={uuidv4()}
        side={THREE.FrontSide}
        positionNode={shaderData.positionNode}
        colorNode={shaderData.colorNode}
        // THis takes most of the GPU time!
        // normalNode={shaderData.normalNode}
        roughnessNode={shaderData.roughnessNode}
        metalness={0.1}
      />
    </>
  );
};

// Main GPUQuadtree component that uses HelloTerrain
const GPUQuadtree = () => {
  const quadtreeControls = useControls("Quadtree Settings", {
    maxLevel: {
      value: 16,
      min: 1,
      max: 32,
      step: 1,
      label: "Max Level",
    },
    maxNodes: {
      value: 2000,
      min: 100,
      max: 10000,
      step: 100,
      label: "Max Nodes",
    },
    rootSize: {
      value: ROOT_SIZE_M,
      min: 256,
      max: ROOT_SIZE_M * 2,
      step: 100,
      label: "Root Size",
    },
    minNodeSize: {
      value: PLANE_EDGE_VERTEX_COUNT + 1,
      min: 16,
      max: 1024,
      step: 10,
      label: "Min Node Size",
    },
    subdivisionFactor: {
      value: 1.5,
      min: 0.5,
      max: 3.0,
      step: 0.1,
      label: "Subdivision Factor",
    },
    planeEdgeVertexCount: {
      value: PLANE_EDGE_VERTEX_COUNT,
      min: 8,
      max: 1024,
      step: 10,
      label: "Plane Edge Vertex Count",
    },
  });

  return (
    <>
      <HelloTerrain
        maxLevel={quadtreeControls.maxLevel}
        rootSize={quadtreeControls.rootSize}
        minNodeSize={quadtreeControls.minNodeSize}
        subdivisionFactor={quadtreeControls.subdivisionFactor}
        maxNodes={quadtreeControls.maxNodes}
        planeEdgeVertexCount={quadtreeControls.planeEdgeVertexCount}
      >
        <OrbitControls />
        <TerrainMaterial />
      </HelloTerrain>
      <fog
        attach="fog"
        args={[
          "#6dd1ed",
          0,
          Math.sqrt(quadtreeControls.rootSize * quadtreeControls.rootSize),
        ]}
      />
      <color attach="background" args={["#6dd1ed"]} />
      <Environment preset="park" background={false} environmentIntensity={1} />
      <ambientLight intensity={0.15} />
    </>
  );
};

const Scene = () => {
  return (
    <Canvas
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
      }}
      shadows
      // biome-ignore lint/suspicious/noExplicitAny: <can't get it to work :p>
      gl={async (props) => {
        props.alpha = true;
        props.antialias = true;
        // soft shadows
        const renderer = new THREE.WebGPURenderer(
          props as WebGPURendererParameters
        );

        renderer.logarithmicDepthBuffer = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.shadowMap.enabled = true;

        await renderer.init();
        return renderer;
      }}
      camera={{
        near: 0.1,
        far: Number.MAX_SAFE_INTEGER,
        position: [100, 2000, 100],
      }}
      dpr={[1, 1]}
      performance={{ min: 0.5 }}
    >
      <GPUQuadtree />
      <Skybox size={ROOT_SIZE_M * 2} />
    </Canvas>
  );
};

export default Scene;
