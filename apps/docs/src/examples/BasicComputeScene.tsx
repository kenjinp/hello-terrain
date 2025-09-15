"use client";

import { useMetrics } from "@/components/Metrics/Metrics";
import { vec2_fbm, warp_fbm } from "@/components/Terrain/fmb";
import * as hello from "@hello-terrain/react";
import {
  ElevationFn,
  type TerrainMesh,
  isSkirtVertex,
  tileIsLeaf,
  tileVertexWorldPosition,
  uRootOrigin,
  uRootSize,
  uSegments,
  uSkirtLength,
} from "@hello-terrain/three";
import { OrbitControls, useTexture } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useMemo, useState } from "react";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import {
  Fn,
  float,
  instanceIndex,
  int,
  positionLocal,
  remap,
  select,
  uniform,
  uv,
  varying,
  vec3,
  vertexIndex,
} from "three/tsl";
import * as THREE from "three/webgpu";

// biome-ignore lint/suspicious/noExplicitAny: <idk its recommended way from drei>
extend(THREE as any);

const TerrainPlane = () => {
  const { camera, gl } = useThree();
  const [helloTerrainMesh, setHelloTerrainMesh] = useState<TerrainMesh | null>(
    null
  );

  const setMetric = useMetrics([
    "updatePosition",
    "heightmapComputeTime",
    "nodeCount",
    "deepestLevel",
    "hash",
    "hasStateChanged",
  ] as const);

  const terrainGeometryControls = useControls("TerrainGeometry", {
    segments: {
      value: 64 - 3,
      min: 2,
      max: 256 - 3,
      step: 2,
      label: "Segments",
    },
    skirtLength: {
      value: 1,
      min: 0,
      max: 20,
      step: 0.2,
      label: "Skirt Length",
    },
    wireframe: {
      value: false,
      label: "Wireframe",
    },
    maxLevel: {
      value: 10,
      min: 1,
      max: 32,
      step: 1,
      label: "Max Level",
    },
    maxNodes: {
      value: 1000,
      min: 100,
      max: 10000,
      step: 100,
      label: "Max Nodes",
    },
    rootSize: {
      value: 10,
      min: 1,
      max: 10000,
      step: 1,
      label: "Root Size",
    },
    minNodeSize: {
      value: 0.1,
      min: 0.1,
      max: 10000,
      step: 0.1,
      label: "Min Node Size",
    },
    subdivisionFactor: {
      value: 2,
      min: 0.1,
      max: 3,
      step: 0.1,
      label: "Subdivision Factor",
    },
    useTexture: {
      value: false,
      label: "Use Texture",
    },
    heightmapScale: {
      value: 1.0,
      min: 0.0,
      max: 1000.0,
      step: 0.1,
      label: "Heightmap Scale",
    },
    fbmIterations: {
      value: 8,
      min: 1,
      max: 30,
      step: 1,
      label: "FBM Iterations",
    },
    fbmAmplitude: {
      value: 1.0,
      min: 0.0,
      max: 10.0,
      step: 0.1,
      label: "FBM Amplitude",
    },
    fbmFrequency: {
      value: 2.0,
      min: 0.0,
      max: 10.0,
      step: 0.1,
      label: "FBM Frequency",
    },
    fbmLacunarity: {
      value: 2.0,
      min: 0.0,
      max: 10.0,
      step: 0.1,
      label: "FBM Lacunarity",
    },
    fbmPersistence: {
      value: 0.5,
      min: 0.0,
      max: 1.0,
      step: 0.01,
      label: "FBM Persistence",
    },
  });

  const uvMap = useTexture("/assets/uv-12x12.png");

  // Memoized varyings
  const uniforms = useMemo(() => {
    return {
      uWireframe: uniform(false).setName("uWireframe"),
      uUseTexture: uniform(false).setName("uUseTexture"),
    };
  }, []);

  useEffect(() => {
    uRootOrigin.value = new THREE.Vector3(0, 0, 0);
    uRootSize.value = terrainGeometryControls.rootSize;
  }, [terrainGeometryControls.rootSize]);

  // Shared varying for global vertex index
  const vGlobalVertexIndex = useMemo(() => varying(int()), []);

  // Memoized nodes
  const positionNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return Fn(() => {
      const nodeStorage = helloTerrainMesh.nodeStorage.storageNode;
      const nodeIndex = instanceIndex;
      const rootSize = uRootSize.toVar();
      const rootOrigin = uRootOrigin.toVar();
      const worldPosition = tileVertexWorldPosition(
        nodeIndex,
        nodeStorage,
        rootSize,
        rootOrigin,
        positionLocal
      );
      const isLeaf = tileIsLeaf(nodeIndex, nodeStorage);
      const skirtLength = uSkirtLength.toVar();

      // Compute and pass global vertex index to fragment stage
      const edge = helloTerrainMesh.params.innerTileSegments + 1 + 2;
      const intEdge = int(edge);
      const verticesPerNode = intEdge.mul(intEdge);
      const globalIndex = nodeIndex.mul(verticesPerNode).add(vertexIndex);
      vGlobalVertexIndex.assign(globalIndex);

      const beforeTransform = select(
        isSkirtVertex,
        vec3(
          worldPosition.x,
          worldPosition.y.sub(float(skirtLength)),
          worldPosition.z
        ),
        worldPosition
      );
      return select(isLeaf, beforeTransform, vec3(0, 0, 0));
    })();
  }, [helloTerrainMesh, vGlobalVertexIndex]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the uniform will be updated by the useFrame hook
  const colorNode = useMemo(() => {
    if (!helloTerrainMesh) {
      return Fn(() => {
        return vec3(0, 0, 0);
      })();
    }
    return Fn(() => {
      return Fn(() => {
        const isLeaf = tileIsLeaf(
          instanceIndex,
          helloTerrainMesh.nodeStorage.storageNode
        );
        // const nodeHashColor = vec3(
        //   hash(clampedGridIndex),
        //   hash(clampedGridIndex.add(1)),
        //   hash(clampedGridIndex.add(2))
        // );
        // const xy = uv();

        // Calculate vertex coordinates within the node
        // Flip Y coordinate to match the compute shader's coordinate system
        // const nodeLocalU = xy.x.mul(helloTerrainMesh.tileEdgeVertexCount).sub(nodeX);
        // const nodeLocalV = xy.y.mul(helloTerrainMesh.tileEdgeVertexCount).sub(nodeY);
        const vertexX = uv()
          .x.mul(helloTerrainMesh.tileEdgeVertexCount)
          .floor();
        const vertexY = float(helloTerrainMesh.tileEdgeVertexCount).sub(
          uv().y.mul(helloTerrainMesh.tileEdgeVertexCount).floor()
        );
        const vertexIndex = vertexY
          .mul(int(helloTerrainMesh.tileEdgeVertexCount))
          .add(vertexX);

        const verticesPerNode = int(
          helloTerrainMesh.tileEdgeVertexCount *
            helloTerrainMesh.tileEdgeVertexCount
        );
        const globalVertexIndex = instanceIndex
          .mul(verticesPerNode)
          .add(vertexIndex);

        const height = helloTerrainMesh.heightmapStorage.storageNode
          .element(globalVertexIndex)
          .remap(0, 1, 0, 255)
          .toColor();

        // Return the color
        return isLeaf.select(height, vec3(1, 0, 0).toColor());
      })();
    })();
  }, [helloTerrainMesh]);

  useFrame(async () => {
    // const adapter = await navigator.gpu.requestAdapter();
    // const device = await adapter.requestDevice();
    // console.log(
    //   "device.limits.maxComputeWorkgroupSizeX",
    //   device.limits.maxComputeWorkgroupSizeX
    // ); // Usually 256 or 1024
    // console.log(
    //   "device.limits.maxComputeInvocationsPerWorkgroup",
    //   device.limits.maxComputeInvocationsPerWorkgroup
    // );

    uniforms.uWireframe.value = terrainGeometryControls.wireframe;
    uniforms.uUseTexture.value = terrainGeometryControls.useTexture;
    uSegments.value = terrainGeometryControls.segments;
    uSkirtLength.value = terrainGeometryControls.skirtLength;
    uRootSize.value = terrainGeometryControls.rootSize;
    if (helloTerrainMesh) {
      // Keep quadtree config in sync with UI controls so subdivision matches rootSize changes
      const qConfig = helloTerrainMesh.quadtree.getConfig();
      qConfig.rootSize = terrainGeometryControls.rootSize;
      qConfig.minNodeSize = terrainGeometryControls.minNodeSize;
      qConfig.subdivisionFactor = terrainGeometryControls.subdivisionFactor;
      qConfig.maxLevel = terrainGeometryControls.maxLevel;
      helloTerrainMesh.update(
        gl as unknown as THREE.WebGPURenderer,
        camera.position
      );
      setMetric(
        "updatePosition",
        helloTerrainMesh.metrics.updatePosition.toString()
      );
      setMetric(
        "hasStateChanged",
        helloTerrainMesh.metrics.hasStateChanged.toString()
      );
      setMetric(
        "deepestLevel",
        helloTerrainMesh.metrics.deepestLevel.toString()
      );
      setMetric(
        "nodeCount",
        `${helloTerrainMesh.metrics.leafNodeCount} / ${helloTerrainMesh.metrics.nodeCount}`
      );
      setMetric("hash", helloTerrainMesh.metrics.hash.toString());
      setMetric(
        "heightmapComputeTime",
        helloTerrainMesh.metrics.heightmapComputeTime.toString()
      );
    }
  });

  useEffect(() => {
    return () => {
      if (helloTerrainMesh) {
        helloTerrainMesh.destroy();
      }
    };
  }, [helloTerrainMesh]);

  return (
    <group>
      {/* <Html>
        <div className="flex flex-col items-center justify-center border-2 border-white rounded-md p-2 bg-black/50">
          <span className="text-white text-lg text-shadow-xl">TerrainMesh</span>
        </div>
      </Html> */}
      <hello.TerrainMesh
        receiveShadow
        castShadow
        frustumCulled={false}
        ref={(ref) => {
          if (!helloTerrainMesh) {
            setHelloTerrainMesh(ref);
          }
        }}
        args={[
          {
            elevationFn: ElevationFn(
              ({
                tileVertexWorldPosition,
                rootSize,
                tileUV,
                tileSize,
                tileLevel,
                nodeIndex,
              }) => {
                const warpStrength = float(0.5);
                const baseStrength = float(1);
                const warpFbm = warp_fbm({
                  position: tileUV,
                });
                const fbm = vec2_fbm(
                  tileUV,
                  terrainGeometryControls.fbmIterations,
                  terrainGeometryControls.fbmAmplitude,
                  terrainGeometryControls.fbmFrequency,
                  terrainGeometryControls.fbmLacunarity,
                  terrainGeometryControls.fbmPersistence
                );
                const noise = warpStrength
                  .mul(warpFbm)
                  .add(baseStrength.mul(fbm));
                const height = noise;
                const heightmapMinElevation = 0;
                const heightmapMaxElevation = 1;
                const remappedHeight = height
                  .remap(heightmapMinElevation, heightmapMaxElevation, 0, 255)
                  .mul(terrainGeometryControls.heightmapScale);
                // return remappedHeight;
                return remap(
                  float(tileLevel),
                  float(0),
                  float(terrainGeometryControls.maxLevel),
                  float(1),
                  float(0)
                ).toFloat();
              }
            ),
            innerTileSegments: terrainGeometryControls.segments,
            maxLevel: terrainGeometryControls.maxLevel,
            rootSize: terrainGeometryControls.rootSize,
            minNodeSize: terrainGeometryControls.minNodeSize,
            subdivisionFactor: terrainGeometryControls.subdivisionFactor,
            maxNodes: terrainGeometryControls.maxNodes,
          },
        ]}
      >
        <meshStandardNodeMaterial
          name="TerrainMeshMaterial"
          wireframe={terrainGeometryControls.wireframe}
          positionNode={positionNode}
          colorNode={colorNode}
        />
      </hello.TerrainMesh>
    </group>
  );
};

const BasicComputeScene = () => {
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
      gl={async (props) => {
        props.alpha = true;
        props.antialias = true;
        // @ts-ignore
        props.requiredLimits = {
          maxComputeWorkgroupsPerDimension: 65535, // Much higher limit
          maxComputeWorkgroupSizeX: 1024,
          maxComputeWorkgroupSizeY: 1024,
          maxComputeWorkgroupSizeZ: 64,
        };
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
        position: [3, 0, 3],
      }}
      dpr={[1, 1]}
      performance={{ min: 0.5 }}
    >
      <color attach="background" args={["#6dd1ed"]} />
      {/* <Environment preset="park" background={false} environmentIntensity={1} /> */}
      <ambientLight intensity={0.15} />
      <directionalLight intensity={1} position={[1, 1, 1]} />
      <OrbitControls />
      <TerrainPlane />
    </Canvas>
  );
};

export default BasicComputeScene;
