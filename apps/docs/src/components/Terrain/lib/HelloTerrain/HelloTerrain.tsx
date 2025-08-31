import { useFrame, useThree } from "@react-three/fiber";
import {
  type FC,
  type PropsWithChildren,
  createContext,
  useContext,
  useMemo,
  useRef,
} from "react";
import { uniform, vec3 } from "three/src/Three.TSL.js";
import type * as THREE from "three/webgpu";
import { StorageInstancedBufferAttribute, Vector3 } from "three/webgpu";
import { Quadtree, type QuadtreeConfig } from "./Quadtree";

export interface HelloTerrainContextType {
  quadTree?: Quadtree;
  mesh?: THREE.InstancedMesh;
}

export const HelloTerrainContext = createContext<HelloTerrainContextType>(
  null as unknown as HelloTerrainContextType
);

export interface HelloTerrainProps extends Omit<QuadtreeConfig, "origin"> {
  planeEdgeVertexCount: number;
  elevationNode: THREE.Node | Readonly<THREE.Node | null | undefined>;
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
    const { nodeBuffer, leafNodeMask } = quadTree
      ?.getNodeView()
      .getBuffers() ?? {
      nodeBuffer: new Float32Array(),
      leafNodeMask: new Uint32Array(),
    };
    const rootOriginUniform = uniform(vec3(0, 0, 0));
    const skirtLengthUniform = uniform(0);
    const rootSizeUniform = uniform(1024 * rootSize);
    const heightmapScaleUniform = uniform(100000);
    const nodeStorageBufferAttribute = new StorageInstancedBufferAttribute(
      nodeBuffer,
      4
    );
    const leafNodeMaskStorageBufferAttribute =
      new StorageInstancedBufferAttribute(leafNodeMask, 1);
    return {
      rootOriginUniform,
      skirtLengthUniform,
      rootSizeUniform,
      heightmapScaleUniform,
      nodeStorageBufferAttribute,
      leafNodeMaskStorageBufferAttribute,
    };
  }, [quadTree, rootSize]);

  // const computeShader = useCallback(async () => {
  //   const gpu = gl as unknown as THREE.WebGPURenderer;
  //   try {
  //     const before = performance.now();
  //     await gpu.computeAsync(Fn(() => {
  //       const index = dispatchIndex
  //       const height = elevationNode()

  //     })().compute(quadTree.getNodeCount(), [planeEdgeVertexCount]));
  //     const after = performance.now();
  //     console.log("computeTime", `${(after - before).toFixed(2)}ms`);

  //   } catch (error) {
  //     console.error("Error in compute shader:", error);
  //   }
  //   return 0;
  // }, [Quadtree, gl, nodeBuffers]);

  useFrame(async () => {
    // TODO, offset by terrain Height ???
    quadTree.update(lodPosition);
    if (quadTree.hasStateChanged(lastHash.current)) {
      computeShader();
      lastHash.current = quadTree.getStateHash();
      // TODO kick off compute shader update.
      if (meshRef?.current) {
        meshRef.current.instanceMatrix.needsUpdate = true;
      }
    }
  });

  // TODO
  // useHelloTerrain() -> quadTree, terrainMesh, positionNode

  return (
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
  );
};

export const useHelloTerrain = () => {
  const context = useContext(HelloTerrainContext);
  if (!context) {
    throw new Error("useHelloTerrain() must be used within a HelloTerrain");
  }
  return context;
};
