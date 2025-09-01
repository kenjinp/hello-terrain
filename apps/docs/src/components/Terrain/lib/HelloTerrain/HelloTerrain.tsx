import { extend, useFrame, useThree } from "@react-three/fiber";
import {
  type FC,
  type PropsWithChildren,
  createContext,
  useContext,
  useMemo,
  useRef,
} from "react";
import {
  Fn,
  instanceIndex,
  int,
  pow,
  storage,
  uniform,
  uv,
  vec3,
} from "three/src/Three.TSL.js";
import { float, hash } from "three/src/nodes/TSL.js";
import * as THREE from "three/webgpu";
import {
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  Vector3,
} from "three/webgpu";
import { Quadtree, type QuadtreeConfig } from "./Quadtree";

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
}) => {
  const { camera, gl } = useThree();
  const lastHash = useRef<number>(0);
  const meshRef = useRef<THREE.InstancedMesh>(undefined);
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
      const index = int(instanceIndex);

      // Calculate which node and vertex within that node this index represents
      const verticesPerNode =
        int(planeEdgeVertexCount).mul(planeEdgeVertexCount);
      const nodeIndex = index.div(verticesPerNode).toFloat().floor().toInt();
      const vertexIndex = index.mod(verticesPerNode);

      // Calculate 2D coordinates within the node's vertex grid
      const x = vertexIndex.mod(int(planeEdgeVertexCount));
      const y = vertexIndex.div(int(planeEdgeVertexCount)).toFloat().floor();

      // Get node data
      const nodeOffset = nodeIndex.mul(int(4));
      const level = nodeStorage.element(nodeOffset);
      const nodeX = nodeStorage.element(nodeOffset.add(int(1)));
      const nodeY = nodeStorage.element(nodeOffset.add(int(2)));
      const isLeaf = nodeStorage.element(nodeOffset.add(int(3))).equal(int(1));
      const root = float(rootSize);

      const tileSize = float(rootSize).div(pow(2.0, level.toFloat()));

      // Calculate world position for this specific vertex within the node
      const vertexOffsetX = x
        .toFloat()
        .div(float(planeEdgeVertexCount).sub(1))
        .sub(0.5);
      const vertexOffsetY = y
        .toFloat()
        .div(float(planeEdgeVertexCount).sub(1))
        .sub(0.5);

      const worldX = vec3(origin).x.add(
        nodeX
          .add(0.5)
          .mul(tileSize)
          .add(vertexOffsetX.mul(tileSize))
          .sub(root.div(2.0))
      );
      const worldZ = vec3(origin).z.add(
        nodeY
          .add(0.5)
          .mul(tileSize)
          .add(vertexOffsetY.mul(tileSize))
          .sub(root.div(2.0))
      );

      const height = isLeaf.select(
        elevationNode
          ? elevationNode({
              worldPosition: vec3(worldX, 0, worldZ),
              rootSize: root,
              heightmapScale: float(1),
            })
          : float(0),
        float(0)
      );

      heightmapStorageNode.element(index).assign(height);
    });
  }, [planeEdgeVertexCount, elevationNode, origin, rootSize]);

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
        computeShaderNode.compute(
          maxNodes * planeEdgeVertexCount * planeEdgeVertexCount,
          [64]
        )
      );
      const end = performance.now();
      console.log(`computeShaderNode took ${end - start}ms`);

      // Force material to update so it picks up the new heightmap data
      if (materialRef?.current) {
        materialRef.current.needsUpdate = true;
      }

      if (meshRef?.current) {
        meshRef.current.instanceMatrix.needsUpdate = true;
      }
    }
  });

  const colorNode = useMemo(() => {
    return Fn(() => {
      // Use textureLoad to sample the WebGPU texture directly
      const xy = uv();

      // Calculate grid size as sqrt(maxNodes) to get a square grid
      const gridSize = pow(maxNodes, 0.5);

      // Calculate which node this pixel belongs to in the grid
      const nodeX = xy.x.mul(gridSize).floor();
      const nodeY = xy.y.mul(gridSize).floor();

      // Calculate node index in the grid
      const gridNodeIndex = nodeY.mul(gridSize).add(nodeX);

      // Clamp the grid node index to valid range
      const clampedGridIndex = gridNodeIndex.clamp(0, maxNodes - 1);

      const nodeOffset = clampedGridIndex.mul(int(4));
      const isLeaf = nodeBuffers.nodeStorage
        .element(nodeOffset.add(int(3)))
        .equal(int(1));

      const nodeHashColor = vec3(
        hash(clampedGridIndex),
        hash(clampedGridIndex.add(1)),
        hash(clampedGridIndex.add(2))
      );

      // Calculate vertex coordinates within the node
      const nodeLocalU = xy.x.mul(gridSize).sub(nodeX);
      const nodeLocalV = xy.y.mul(gridSize).sub(nodeY);
      const vertexX = nodeLocalU.mul(planeEdgeVertexCount).floor();
      const vertexY = nodeLocalV.mul(planeEdgeVertexCount).floor();
      const vertexIndex = vertexY.mul(int(planeEdgeVertexCount)).add(vertexX);

      const verticesPerNode = int(planeEdgeVertexCount * planeEdgeVertexCount);
      const globalVertexIndex = clampedGridIndex
        .mul(verticesPerNode)
        .add(vertexIndex);

      const height =
        nodeBuffers.heightmapStorageNode.element(globalVertexIndex);

      // Return the color
      return isLeaf.select(vec3(height), vec3(1, 0, 0));
    })();
  }, [
    maxNodes,
    planeEdgeVertexCount,
    nodeBuffers.nodeStorage,
    nodeBuffers.heightmapStorageNode,
  ]);

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
