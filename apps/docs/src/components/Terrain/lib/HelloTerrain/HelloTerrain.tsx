import { extend, useFrame, useThree } from "@react-three/fiber";
import {
  type FC,
  type PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Fn,
  instanceIndex,
  int,
  storage,
  uniform,
  uv,
  vec3,
} from "three/src/Three.TSL.js";
import { float } from "three/src/nodes/TSL.js";
import * as THREE from "three/webgpu";
import {
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  Vector3,
} from "three/webgpu";
import { Quadtree, type QuadtreeConfig } from "./Quadtree";
import { getDevice } from "./getDevice";

// Extend THREE to include node materials in JSX
extend(THREE as any);

export interface HelloTerrainContextType {
  quadTree?: Quadtree;
  mesh?: THREE.InstancedMesh;
}

export const HelloTerrainContext = createContext<HelloTerrainContextType>(
  null as unknown as HelloTerrainContextType
);

export interface HelloTerrainProps extends Omit<QuadtreeConfig, "origin"> {
  planeEdgeVertexCount: number;
  elevationNode?: THREE.Node | Readonly<THREE.Node | null | undefined>;
  splatNode?: THREE.Node | Readonly<THREE.Node | null | undefined>;
  origin?: THREE.Vector3;
  resolveLODPosition?: THREE.Vector3;
}

export const HelloTerrain: FC<PropsWithChildren<HelloTerrainProps>> = ({
  maxLevel,
  rootSize,
  minNodeSize,
  origin = new Vector3(0, 0, 0),
  subdivisionFactor,
  maxNodes,
  planeEdgeVertexCount,
  resolveLODPosition,
  children,
  elevationNode,
  splatNode,
}) => {
  const { camera, gl } = useThree();
  const lastHash = useRef<number>(0);
  const meshRef = useRef<THREE.InstancedMesh>(undefined);
  const [device, setDevice] = useState<globalThis.GPUDevice>(undefined);
  const lodPosition = useMemo(() => {
    if (resolveLODPosition) {
      return resolveLODPosition;
    }
    return camera.position;
  }, [resolveLODPosition, camera]);

  const quadTree = useMemo(() => {
    return new Quadtree({
      maxLevel,
      rootSize,
      minNodeSize,
      origin,
      subdivisionFactor,
      maxNodes,
    });
  }, [maxLevel, rootSize, minNodeSize, origin, subdivisionFactor, maxNodes]);

  const value = useMemo(
    () => ({
      quadTree,
      mesh: meshRef.current,
    }),
    [quadTree]
  );

  useEffect(() => {
    (async () => {
      setDevice(await getDevice());
    })();
  }, []);

  const nodeBuffers = useMemo(() => {
    const { nodeBuffer, leafNodeMask } = quadTree.getNodeView().getBuffers();
    const rootOriginUniform = uniform(vec3(0, 0, 0));
    const skirtLengthUniform = uniform(0);
    const rootSizeUniform = uniform(1024 * rootSize);
    const heightmapScaleUniform = uniform(100000);
    const nodeStorageBufferAttribute = new StorageInstancedBufferAttribute(
      nodeBuffer,
      4
    );

    const heightmapStorageNode = storage(
      new StorageBufferAttribute(
        new Float32Array(
          planeEdgeVertexCount * planeEdgeVertexCount * maxNodes
        ),
        1
      ),
      "f32",
      planeEdgeVertexCount * planeEdgeVertexCount * maxNodes
    );

    const normalMapStorageNode = storage(
      new StorageBufferAttribute(
        new Float32Array(
          planeEdgeVertexCount * planeEdgeVertexCount * maxNodes
        ),
        3
      ),
      "f32",
      planeEdgeVertexCount * planeEdgeVertexCount * maxNodes
    );

    const splatStorageNode = storage(
      new StorageBufferAttribute(
        new Float32Array(
          planeEdgeVertexCount * planeEdgeVertexCount * maxNodes
        ),
        4
      ),
      "f32",
      planeEdgeVertexCount * planeEdgeVertexCount * maxNodes
    );

    const leafNodeMaskStorageBufferAttribute =
      new StorageInstancedBufferAttribute(leafNodeMask, 1);

    const nodeStorage = storage(
      nodeStorageBufferAttribute,
      "i32",
      maxNodes * 4
    ); // 4 integers per node
    const leafNodeMaskStorage = storage(
      leafNodeMaskStorageBufferAttribute,
      "u32",
      maxNodes
    );

    return {
      rootOriginUniform,
      skirtLengthUniform,
      rootSizeUniform,
      heightmapScaleUniform,
      nodeStorageBufferAttribute,
      leafNodeMaskStorageBufferAttribute,
      heightmapStorageNode,
      normalMapStorageNode,
      splatStorageNode,
      nodeStorage,
      leafNodeMaskStorage,
    };
  }, [quadTree, rootSize, planeEdgeVertexCount, maxNodes]);

  const computeShader = useMemo(() => {
    return Fn(({ heightmapStorageNode, nodeStorage }) => {
      const index = instanceIndex;

      // Calculate 2D coordinates for the heightmap
      const x = index.mod(planeEdgeVertexCount);
      const y = index.div(planeEdgeVertexCount).toFloat().floor();
      const layer = index
        .div(planeEdgeVertexCount * planeEdgeVertexCount)
        .toFloat()
        .floor();

      // Generate height value based on position
      const height = x
        .toFloat()
        .mul(0.01)
        .add(y.toFloat().mul(0.01))
        .add(layer.toFloat().mul(0.1));

      const nodeIndex = instanceIndex;
      const nodeOffset = nodeIndex.mul(int(4));
      const level = nodeStorage.element(nodeOffset);
      const nodeX = nodeStorage.element(nodeOffset.add(int(1)));
      const nodeY = nodeStorage.element(nodeOffset.add(int(2)));
      const isLeaf = nodeStorage.element(nodeOffset.add(int(3))).equal(int(1));

      heightmapStorageNode
        .element(index)
        .assign(isLeaf.select(height, float(0)));
    });
  }, [planeEdgeVertexCount, nodeBuffers, maxNodes]);

  console.log("device", device);

  useFrame(async () => {
    // TODO, offset by terrain Height ???
    quadTree.update(lodPosition);

    if (quadTree.hasStateChanged(lastHash.current)) {
      lastHash.current = quadTree.getStateHash();
      nodeBuffers.nodeStorageBufferAttribute.needsUpdate = true;

      const start = performance.now();
      const gpu = gl as unknown as THREE.WebGPURenderer;
      const computeShaderNode = computeShader({
        heightmapStorageNode: nodeBuffers.heightmapStorageNode,
        nodeStorage: nodeBuffers.nodeStorage,
      });
      computeShaderNode.needsUpdate = true;
      await gpu.computeAsync(
        computeShaderNode.compute(maxNodes, [planeEdgeVertexCount])
      );
      const end = performance.now();
      console.log(`computeShaderNode took ${end - start}ms`);

      // Force material to update so it picks up the new heightmap data
      if (materialRef?.current) {
        materialRef.current.needsUpdate = true;
      }

      if (meshRef?.current) {
        meshRef.current.instanceMatrix.needsUpdate = true;
        meshRef.current.material.needsUpdate = true;
      }
    }
  });

  const colorNode = useMemo(() => {
    return Fn(() => {
      // Use textureLoad to sample the WebGPU texture directly
      const xy = uv();

      // Create a board pattern where each node is a single pixel
      // Calculate which node this pixel belongs to
      const nodeX = xy.x.mul(planeEdgeVertexCount).floor();
      const nodeY = xy.y.mul(planeEdgeVertexCount).floor();

      // Calculate node index in the grid
      const nodeIndex = nodeY.mul(planeEdgeVertexCount).add(nodeX);

      // Get heightmap value for this node
      const heightValue = nodeBuffers.heightmapStorageNode.element(nodeIndex);

      // Display heightmap value as grayscale
      return vec3(heightValue, heightValue, heightValue);
    })();
  }, [nodeBuffers, planeEdgeVertexCount]);

  // Create a ref to the material so we can force updates
  const materialRef = useRef<THREE.MeshStandardNodeMaterial>(null);

  console.log("materialRef", materialRef.current);
  // TODO
  // useHelloTerrain() -> quadTree, terrainMesh, positionNode

  return (
    <>
      <mesh>
        <boxGeometry
          args={[rootSize / 1000, rootSize / 1000, rootSize / 1000]}
        />
        <meshPhysicalNodeMaterial ref={materialRef} colorNode={colorNode} />
      </mesh>
      <HelloTerrainContext.Provider value={value}>
        <instancedMesh
          ref={meshRef}
          receiveShadow
          castShadow
          frustumCulled={false}
          args={[undefined, undefined, maxNodes]}
        >
          {/* add 2 to the edge vertex count to account for the skirt */}
          <planeGeometry
            args={[1, 1, planeEdgeVertexCount + 2, planeEdgeVertexCount + 2]}
          />
          {children}
        </instancedMesh>
      </HelloTerrainContext.Provider>
    </>
  );
};

export const useHelloTerrain = () => {
  const context = useContext(HelloTerrainContext);
  if (!context) {
    throw new Error("useHelloTerrain() must be used within a HelloTerrain");
  }
  return context;
};
