import { extend, useFrame, useThree } from "@react-three/fiber";
import { type FC, createContext, useContext, useMemo, useRef } from "react";
import {
  Fn,
  instanceIndex,
  int,
  pow,
  select,
  storage,
  transformNormalToView,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
} from "three/src/Three.TSL.js";
import {
  type ShaderNodeObject,
  float,
  hash,
  vertexIndex,
} from "three/src/nodes/TSL.js";
import * as THREE from "three/webgpu";
import {
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  Vector3,
} from "three/webgpu";
import type { ElevationReturn } from "../TSLNodes/ElevationFn";
import { Quadtree, type QuadtreeConfig } from "./Quadtree";

// Extend THREE to include node materials in JSX
extend(THREE as any);

// Extend THREE to include custom terrain geometry
extend({ TerrainSkirtGeometry });

export interface HelloTerrainContextType {
  quadTree?: Quadtree;
  mesh?: THREE.InstancedMesh;
}

export const HelloTerrainContext = createContext<HelloTerrainContextType>(
  null as unknown as HelloTerrainContextType
);

export interface HelloTerrainProps extends Omit<QuadtreeConfig, "origin"> {
  chunkSegments: number;
  elevationNode?: ElevationReturn;
  splatNode?: THREE.Node | Readonly<THREE.Node | null | undefined>;
  origin?: THREE.Vector3;
  skirtLength?: number;
  resolveLODPosition?: THREE.Vector3;
  children: ({
    positionNode,
    colorNode,
    normalNode,
  }: {
    positionNode: THREE.Node;
    colorNode: THREE.Node;
    normalNode: THREE.Node;
  }) => React.ReactNode;
}

export const HelloTerrain: FC<HelloTerrainProps> = ({
  maxLevel,
  rootSize,
  minNodeSize,
  skirtLength = 0,
  origin = new Vector3(0, 0, 0),
  subdivisionFactor,
  maxNodes,
  chunkSegments,
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

  const chunkEdgeVertextCount = chunkSegments + 1;
  const chunkEdgeVertextCountWithSkirt = chunkSegments + 1 + 2;

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

    // const heighmapStorageTexture = new THREE.StorageTexture(
    //   planeEdgeVertexCount * maxNodes,
    //   planeEdgeVertexCount
    // );

    const heightmapStorageBufferAttribute = new StorageBufferAttribute(
      new Float32Array(
        chunkEdgeVertextCount * chunkEdgeVertextCount * maxNodes
      ),
      1
    );

    const heightmapStorageNode = storage(
      heightmapStorageBufferAttribute,
      "f32",
      chunkEdgeVertextCount * chunkEdgeVertextCount * maxNodes
    );

    const normalMapStorageBufferAttribute = new StorageBufferAttribute(
      // 3 components per vertex (x, y, z)
      new Float32Array(
        chunkEdgeVertextCount * chunkEdgeVertextCount * maxNodes * 3
      ),
      3
    );

    const normalMapStorageNode = storage(
      normalMapStorageBufferAttribute,
      "f32",
      chunkEdgeVertextCount * chunkEdgeVertextCount * maxNodes
    );

    const splatStorageNode = storage(
      new StorageBufferAttribute(
        new Float32Array(
          chunkEdgeVertextCount * chunkEdgeVertextCount * maxNodes
        ),
        4
      ),
      "f32",
      chunkEdgeVertextCount * chunkEdgeVertextCount * maxNodes
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
      heightmapStorageBufferAttribute,
      normalMapStorageNode,
      normalMapStorageBufferAttribute,
      splatStorageNode,
      nodeStorage,
      leafNodeMaskStorage,
    };
  }, [quadTree, rootSize, chunkEdgeVertextCount, maxNodes]);

  const computeShaders = useMemo(() => {
    const heightmapComputeShader = Fn(
      ({ heightmapStorageNode, nodeStorage }) => {
        const index = int(instanceIndex);

        // Calculate which node and vertex within that node this index represents
        const verticesPerNode = int(chunkEdgeVertextCount).mul(
          chunkEdgeVertextCount
        );
        const nodeIndex = index.div(verticesPerNode).toFloat().floor().toInt();
        const vertexIndex = index.mod(verticesPerNode);

        // Calculate 2D coordinates within the node's vertex grid
        const x = vertexIndex.mod(int(chunkEdgeVertextCount));
        const y = vertexIndex.div(int(chunkEdgeVertextCount)).toFloat().floor();

        // Get node data
        const nodeOffset = nodeIndex.mul(int(4));
        const level = nodeStorage.element(nodeOffset);
        const nodeX = nodeStorage.element(nodeOffset.add(int(1)));
        const nodeY = nodeStorage.element(nodeOffset.add(int(2)));
        const isLeaf = nodeStorage
          .element(nodeOffset.add(int(3)))
          .equal(int(1));
        const root = float(rootSize);

        const tileSize = float(rootSize).div(pow(2.0, level.toFloat()));

        // Calculate world position for this specific vertex within the node
        const vertexOffsetX = x
          .toFloat()
          .div(float(chunkEdgeVertextCount))
          .sub(0.5);
        const vertexOffsetY = y
          .toFloat()
          .div(float(chunkEdgeVertextCount))
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
        // build uv coordinates from world position
        // 0 to 1
        const worldUv = vec2(worldX.div(rootSize), worldZ.div(rootSize));

        // For edge vertices (skirts), set height to 0 or a very low value
        // For inner vertices, compute actual height
        const height = isLeaf.select(
          elevationNode
            ? elevationNode({
                worldPosition: vec3(worldX, 0, worldZ),
                rootSize: root,
                heightmapScale: float(1),
                worldUv,
                level,
                tileSize,
                nodeX,
                nodeY,
              })
            : float(0)
        );

        heightmapStorageNode.element(index).assign(height);
      }
    );

    const normalMapComputeShader = Fn(
      ({ normalMapStorageNode, heightmapStorageNode, nodeStorage }) => {}
    );

    return {
      heightmapComputeShader,
      normalMapComputeShader,
    };
  }, [chunkEdgeVertextCount, elevationNode, origin, rootSize]);

  useFrame(async () => {
    // TODO, offset by terrain Height ???
    quadTree.update(lodPosition);

    if (quadTree.hasStateChanged(lastHash.current)) {
      lastHash.current = quadTree.getStateHash();
      nodeBuffers.nodeStorageBufferAttribute.needsUpdate = true;
      nodeBuffers.heightmapStorageBufferAttribute.needsUpdate = true;
      nodeBuffers.normalMapStorageBufferAttribute.needsUpdate = true;
      let start = performance.now();
      const gpu = gl as unknown as THREE.WebGPURenderer;
      const heightmapComputeShaderNode = computeShaders.heightmapComputeShader({
        heightmapStorageNode: nodeBuffers.heightmapStorageNode,
        nodeStorage: nodeBuffers.nodeStorage,
      });
      await gpu.computeAsync(
        heightmapComputeShaderNode.compute(
          maxNodes * chunkEdgeVertextCount * chunkEdgeVertextCount,
          [64]
        )
      );
      let end = performance.now();
      console.log(`computeShaderNode took ${end - start}ms`);

      start = performance.now();
      const normalMapComputeShaderNode = computeShaders.normalMapComputeShader({
        normalMapStorageNode: nodeBuffers.normalMapStorageNode,
        heightmapStorageNode: nodeBuffers.heightmapStorageNode,
        nodeStorage: nodeBuffers.nodeStorage,
      });

      await gpu.computeAsync(
        normalMapComputeShaderNode.compute(
          maxNodes * chunkEdgeVertextCount * chunkEdgeVertextCount,
          [64]
        )
      );

      end = performance.now();
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

  const debugNodeColor = useMemo(() => {
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
      // Flip Y coordinate to match the compute shader's coordinate system
      const nodeLocalU = xy.x.mul(gridSize).sub(nodeX);
      const nodeLocalV = xy.y.mul(gridSize).sub(nodeY);
      const vertexX = nodeLocalU.mul(chunkEdgeVertextCountWithSkirt).floor();
      const vertexY = float(chunkEdgeVertextCountWithSkirt).sub(
        nodeLocalV.mul(chunkEdgeVertextCountWithSkirt).floor()
      );
      const vertexIndex = vertexY
        .mul(int(chunkEdgeVertextCountWithSkirt))
        .add(vertexX);

      const verticesPerNode = int(
        chunkEdgeVertextCountWithSkirt * chunkEdgeVertextCountWithSkirt
      );
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
    chunkEdgeVertextCount,
    nodeBuffers.nodeStorage,
    nodeBuffers.heightmapStorageNode,
  ]);

  // Create a ref to the material so we can force updates
  const materialRef = useRef<THREE.MeshStandardNodeMaterial>(null);

  console.log("materialRef", materialRef.current);
  // TODO
  // useHelloTerrain() -> quadTree, terrainMesh, positionNode

  const uniforms = useMemo(() => {
    return {
      rootOriginUniform: uniform(origin),
      rootSizeUniform: uniform(rootSize),
      skirtLengthUniform: uniform(skirtLength),
      deltaUniform: uniform(0.0),
    };
  }, [rootSize, skirtLength, origin]);

  const varyings = useMemo(() => {
    return {
      vWorldUv: varying(vec2()),
      vNormal: varying(vec3()),
      vPosition: varying(vec3()),
      vGlobalVertexIndex: varying(int()),
      vNodeIndex: varying(int()),
      vVertexIndex: varying(vertexIndex),
    };
  }, []);

  // Reusable function to calculate global vertex index from UV coordinates
  const calculateGlobalVertexIndex = useMemo(() => {
    return Fn(
      ({
        uvX,
        uvY,
        edgeVertexCount,
      }: {
        uvX: ShaderNodeObject<THREE.Node>;
        uvY: ShaderNodeObject<THREE.Node>;
        edgeVertexCount: number;
      }) => {
        const nodeIndex = instanceIndex;
        const verticesPerNode = int(edgeVertexCount * edgeVertexCount);

        // Calculate vertex coordinates within the node based on UV coordinates
        // Use the same coordinate system as the compute shader
        const vertexX = uvX.mul(edgeVertexCount).floor();
        const vertexY = uvY.mul(edgeVertexCount).floor();
        const vertexIndex = vertexY.mul(int(edgeVertexCount)).add(vertexX);

        // Calculate global vertex index
        return nodeIndex.mul(verticesPerNode).add(vertexIndex);
      }
    );
  }, []);

  const positionNode = useMemo(() => {
    const vertexPositions = Fn(() => {
      const nodeIndex = instanceIndex;
      const nodeOffset = nodeIndex.mul(int(4));
      const level = nodeBuffers.nodeStorage.element(nodeOffset);
      const nodeX = nodeBuffers.nodeStorage.element(nodeOffset.add(int(1)));
      const nodeY = nodeBuffers.nodeStorage.element(nodeOffset.add(int(2)));
      const isLeaf = nodeBuffers.nodeStorage
        .element(nodeOffset.add(int(3)))
        .equal(int(1));

      const rootSize = uniforms.rootSizeUniform.toVar();
      const rootOrigin = uniforms.rootOriginUniform.toVar();

      // // Compute world-space position centred so that the entire root tile spans [-rootSize/2, rootSize/2]
      const tileSize = rootSize.div(pow(2.0, level.toFloat()));
      const worldX = rootOrigin.x.add(
        nodeX.add(0.5).mul(tileSize).sub(rootSize.div(2.0))
      );
      const worldZ = rootOrigin.z.add(
        nodeY.add(0.5).mul(tileSize).sub(rootSize.div(2.0))
      );

      // Calculate the UV step size for the geometry with skirt
      const uvStep = float(1.0).div(float(chunkEdgeVertextCountWithSkirt - 1));

      // Detect if we're on the first or last vertex (skirt vertices)
      const isOnEdgeX = uv()
        .x.lessThan(uvStep.mul(0.5))
        .or(uv().x.greaterThan(float(1.0).sub(uvStep.mul(0.5))));
      const isOnEdgeY = uv()
        .y.lessThan(uvStep.mul(0.5))
        .or(uv().y.greaterThan(float(1.0).sub(uvStep.mul(0.5))));
      const isOnEdge = isOnEdgeX.or(isOnEdgeY);

      // For inner vertices, remap UV coordinates to span only the inner vertex range
      // This ensures inner vertices are positioned as if no skirt exists
      const skirtOffset = uvStep;
      const innerUvX = uv()
        .x.sub(skirtOffset)
        .div(float(1.0).sub(skirtOffset.mul(2.0)));
      const innerUvY = uv()
        .y.sub(skirtOffset)
        .div(float(1.0).sub(skirtOffset.mul(2.0)));

      // Convert UV coordinates to local offsets (-0.5 to 0.5 range)
      const localU = isOnEdge.select(uv().x.sub(0.5), innerUvX.sub(0.5));
      const localV = isOnEdge.select(uv().y.sub(0.5), innerUvY.sub(0.5));

      const scaledLocalX = localU.mul(tileSize);
      const scaledLocalZ = localV.mul(tileSize);
      const finalWorldX = worldX.add(scaledLocalX);
      const finalWorldZ = worldZ.sub(scaledLocalZ);

      return vec3(finalWorldX, 0, finalWorldZ);

      // For skirts, use the original UV coordinates to position at edges
      const skirtLocalX = uv().x.sub(0.5).mul(tileSize);
      const skirtLocalZ = uv().y.sub(0.5).mul(tileSize);
      const skirtWorldX = worldX.add(skirtLocalX);
      const skirtWorldZ = worldZ.sub(skirtLocalZ);

      // Calculate the global vertex index using built-in vertexIndex
      // The built-in vertexIndex goes from 0 to (chunkEdgeVertextCountWithSkirt * chunkEdgeVertextCountWithSkirt - 1)
      const currentNodeIndex = instanceIndex; // Node index (0 to maxNodes-1)
      const verticesPerNode = int(
        chunkEdgeVertextCount * chunkEdgeVertextCount
      );

      // Map the built-in vertexIndex to inner vertex coordinates (excluding skirt)
      // The geometry has skirt vertices, but the heightmap only covers inner vertices
      const geometryVertexIndex = vertexIndex; // Built-in vertex index
      const geometryVerticesPerEdge = int(chunkEdgeVertextCountWithSkirt);

      // Calculate 2D coordinates within the geometry
      const geometryX = geometryVertexIndex.mod(geometryVerticesPerEdge);
      const geometryY = geometryVertexIndex.div(geometryVerticesPerEdge);

      // Check if this vertex is a skirt vertex (on the edges)
      const isSkirtVertex = geometryX
        .lessThan(int(1))
        .or(geometryX.greaterThan(int(chunkEdgeVertextCount)))
        .or(geometryY.lessThan(int(1)))
        .or(geometryY.greaterThan(int(chunkEdgeVertextCount)));

      // Map geometry coordinates to inner vertex coordinates (subtract 1 to account for skirt)
      const innerVertexX = geometryX.sub(int(1));
      const innerVertexY = geometryY.sub(int(1));
      const innerVertexIndex = innerVertexY
        .mul(int(chunkEdgeVertextCount))
        .add(innerVertexX);

      // Calculate the global vertex index (same as compute shader)
      const calculatedIndex = currentNodeIndex
        .mul(verticesPerNode)
        .add(innerVertexIndex);
      const maxValidIndex = int(
        maxNodes * chunkEdgeVertextCount * chunkEdgeVertextCount - 1
      );
      const clampedIndex = calculatedIndex.clamp(0, maxValidIndex);

      const globalVertexIndex = isSkirtVertex.select(
        int(0), // Use index 0 for skirt vertices
        clampedIndex
      );

      varyings.vGlobalVertexIndex.assign(globalVertexIndex);
      varyings.vVertexIndex.assign(geometryVertexIndex);

      // Calculate height for both inner and skirt vertices
      const innerVertexHeight =
        nodeBuffers.heightmapStorageNode.element(globalVertexIndex);

      // For skirt vertices, find the nearest inner vertex and use its height
      const nearestInnerVertexX = geometryX.clamp(
        int(1),
        int(chunkEdgeVertextCount)
      );
      const nearestInnerVertexY = geometryY.clamp(
        int(1),
        int(chunkEdgeVertextCount)
      );
      const nearestInnerVertexIndex = nearestInnerVertexY
        .sub(int(1))
        .mul(int(chunkEdgeVertextCount))
        .add(nearestInnerVertexX.sub(int(1)));
      const nearestInnerGlobalIndex = currentNodeIndex
        .mul(verticesPerNode)
        .add(nearestInnerVertexIndex);
      const nearestInnerHeight = nodeBuffers.heightmapStorageNode.element(
        nearestInnerGlobalIndex
      );

      const height = isSkirtVertex.select(
        nearestInnerHeight, // Use height from nearest inner vertex for skirt vertices
        innerVertexHeight // Use calculated height for inner vertices
      );

      const scaledPositionExcludingSkirt = Fn(() => {
        return vec3(finalWorldX, height, finalWorldZ);
      });

      const skirtPosition = Fn(() => {
        // For skirt vertices, subtract skirt length from the nearest inner vertex height
        const skirtLength = uniforms.skirtLengthUniform.toVar();
        const skirtHeight = height.sub(skirtLength);

        return vec3(skirtWorldX, skirtHeight, skirtWorldZ);
      });

      varyings.vPosition.assign(
        select(
          isLeaf.not(),
          vec3(0.0),
          select(isSkirtVertex, skirtPosition(), scaledPositionExcludingSkirt())
        )
      );

      // return varyings.vPosition;
    });

    return vertexPositions();
  }, [
    uniforms,
    varyings,
    nodeBuffers.nodeStorage,
    nodeBuffers.heightmapStorageNode,
    chunkEdgeVertextCount,
    calculateGlobalVertexIndex,
  ]);

  const normalNode = useMemo(() => {
    return transformNormalToView(varyings.vNormal);
  }, [varyings.vNormal]);

  const colorNode = useMemo(() => {
    return Fn(() => {
      // Use the vertex index from the varying (calculated in position shader)
      const vVertexIndex = vertexIndex;

      // Calculate 2D coordinates within the geometry
      const geometryVerticesPerEdge = int(chunkEdgeVertextCountWithSkirt);
      const geometryX = vVertexIndex.mod(geometryVerticesPerEdge);
      const geometryY = vVertexIndex.div(geometryVerticesPerEdge);

      // Map to inner vertex grid coordinates (clamp to inner vertex range)
      const innerVertexX = geometryX.clamp(int(1), int(chunkEdgeVertextCount));
      const innerVertexY = geometryY.clamp(int(1), int(chunkEdgeVertextCount));

      // Convert to 0-1 range for color components
      // R component: increases along Y-axis (rows)
      const rComponent = innerVertexY
        .sub(int(1))
        .toFloat()
        .div(float(chunkEdgeVertextCount - 1));

      // B component: increases along X-axis (columns)
      const bComponent = innerVertexX
        .sub(int(1))
        .toFloat()
        .div(float(chunkEdgeVertextCount - 1));

      // G component: can be used to show if this is a skirt vertex or inner vertex
      const isSkirtVertex = geometryX
        .lessThan(int(1))
        .or(geometryX.greaterThan(int(chunkEdgeVertextCount)))
        .or(geometryY.lessThan(int(1)))
        .or(geometryY.greaterThan(int(chunkEdgeVertextCount)));
      const gComponent = isSkirtVertex.select(float(0), float(1.0)); // Skirt vertices are dimmer

      // Create the grid color
      const gridColor = vec3(
        rComponent,
        rComponent,
        // bComponent.clamp(0.0, 1.0)
        rComponent
      );

      // return select(isSkirtVertex, vec3(0, 0, 0), gridColor);
      return vec3(uv().x, uv().y, 0);
    })();
  }, [
    varyings.vVertexIndex,
    chunkEdgeVertextCount,
    chunkEdgeVertextCountWithSkirt,
  ]);

  return (
    <>
      <mesh>
        <boxGeometry
          args={[rootSize / 1000, rootSize / 1000, rootSize / 1000]}
        />
        <meshPhysicalNodeMaterial
          ref={materialRef}
          colorNode={debugNodeColor}
        />
      </mesh>
      <HelloTerrainContext.Provider value={value}>
        <instancedMesh
          ref={meshRef}
          receiveShadow
          castShadow
          frustumCulled={false}
          args={[undefined, undefined, maxNodes]}
        >
          {/* Use custom terrain geometry with proper skirt corner handling */}
          <terrainSkirtGeometry args={[chunkSegments]} />
          {children({ positionNode, colorNode, normalNode })}
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
