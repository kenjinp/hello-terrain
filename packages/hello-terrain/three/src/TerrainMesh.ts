import { float, int, vec3 } from "three/tsl";
import {
  InstancedMesh,
  type NodeMaterial,
  Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import { ComputeToBufferMap } from "./compute/ComputeToBufferMap";
import { StorageBuffer } from "./compute/StorageBuffer";
import { TerrainGeometry } from "./geometry/TerrainGeometry";
import { ElevationFn, type ElevationReturn } from "./nodes/ElevationFn";
import { height } from "./nodes/height";
import { uRootOrigin, uRootSize } from "./nodes/uniforms";
import { Quadtree, type QuadtreeParams } from "./quadtree/Quadtree";

export interface TerrainMeshParams extends Omit<QuadtreeParams, "origin"> {
  innerTileSegments: number;
  material?: NodeMaterial;
  elevationFn?: ElevationReturn;
}

export class TerrainMesh extends InstancedMesh {
  quadtree: Quadtree;
  lastHash: number;
  metrics: Record<string, string | number | boolean>;
  public readonly tileEdgeVertexCount: number;
  public readonly nodeStorage: StorageBuffer;
  public readonly heightmapStorage: StorageBuffer;
  public readonly normalmapStorage: StorageBuffer;
  private heightmapComputeShader: ComputeToBufferMap;
  constructor(public readonly params: TerrainMeshParams) {
    const { innerTileSegments, material, ...quadtreeParams } = params;
    const geometry = new TerrainGeometry(params.innerTileSegments, true);
    super(geometry, material, quadtreeParams.maxNodes);
    this.quadtree = new Quadtree({
      ...quadtreeParams,
      origin: this.position.clone(),
    });

    this.nodeStorage = new StorageBuffer(
      "nodeStorage",
      this.quadtree.getNodeView().getBuffers().nodeBuffer,
      4,
      quadtreeParams.maxNodes
    );

    this.lastHash = 0;
    this.metrics = {
      hashTime: 0,
      hash: 0,
      hasStateChanged: false,
      leafNodeCount: 0,
      nodeCount: 0,
    };

    const tileEdgeVertexCount = innerTileSegments + 1 + 2;
    this.tileEdgeVertexCount = tileEdgeVertexCount;
    if (tileEdgeVertexCount > 256) {
      throw new Error("innerTileSegments exceeds the maximum of 253");
    }

    const computeTextureHeight = tileEdgeVertexCount;
    const computeTextureWidth = computeTextureHeight * quadtreeParams.maxNodes;
    const heightmapDimensions = computeTextureWidth * computeTextureHeight;
    this.heightmapStorage = new StorageBuffer(
      "heightmapStorage",
      new Float32Array(heightmapDimensions).fill(1),
      1,
      quadtreeParams.maxNodes
    );
    this.normalmapStorage = new StorageBuffer(
      "normalmapStorage",
      new Float32Array(heightmapDimensions * 3),
      3,
      quadtreeParams.maxNodes
    );

    this.heightmapComputeShader = new ComputeToBufferMap(
      (nodeIndex, globalVertexIndex, localUV, _texelSize) => {
        const origin = vec3(
          new Vector3(this.position.x, this.position.y, this.position.z)
        );
        const h = height(
          nodeIndex,
          this.nodeStorage.storageNode,
          int(this.params.rootSize),
          origin,
          localUV,
          this.params.elevationFn ?? ElevationFn(() => float(0))
        );
        this.heightmapStorage.storageNode.element(globalVertexIndex).assign(h);
      }
    );
    this.heightmapComputeShader.createBinds(
      tileEdgeVertexCount,
      1,
      this.heightmapStorage
    );

    uRootOrigin.value = this.position;
    uRootSize.value = this.params.rootSize;
    console.log("TerrainMesh constructed", this);
  }
  async update(renderer: WebGPURenderer, position: Vector3) {
    uRootOrigin.value = this.position;
    uRootSize.value = this.params.rootSize;
    this.setMetric(
      "updatePosition",
      `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`
    );
    this.quadtree.update(position);
    // update compute shader nodes
    // update storage buffers

    if (this.quadtree.hasStateChanged(this.lastHash)) {
      const beforeHeightmapCompute = performance.now();
      // Ensure node storage reflects latest quadtree state before compute
      this.nodeStorage.update(
        this.quadtree.getNodeView().getBuffers().nodeBuffer
      );
      this.heightmapStorage.update();
      this.heightmapComputeShader.renderBind(renderer, this.heightmapStorage);

      // const buffer = await renderer.getArrayBufferAsync(
      //   this.heightmapStorage.storageBufferAttribute
      // );

      // const f32 = new Float32Array(buffer);
      // const first100 = f32.subarray(0, Math.min(100, f32.length));
      // console.log("heightmapStorage first 100 f32:", Array.from(f32));

      const afterHeightmapCompute = performance.now();
      this.setMetric(
        "heightmapComputeTime",
        `${afterHeightmapCompute - beforeHeightmapCompute}ms`
      );
      const beforeHash = performance.now();
      this.lastHash = this.quadtree.getStateHash();
      const afterHash = performance.now();
      this.setMetric("hashTime", `${(afterHash - beforeHash).toFixed(2)}ms`);
      this.setMetric("hash", this.lastHash.toString());
      this.setMetric(
        "deepestLevel",
        this.quadtree.getDeepestLevel().toString()
      );
      this.setMetric(
        "leafNodeCount",
        this.quadtree.getLeafNodeCount().toString()
      );
      this.setMetric("nodeCount", this.quadtree.getNodeCount().toString());
      this.setMetric("hasStateChanged", "true");
    } else {
      this.setMetric("hasStateChanged", "false");
    }
  }

  setMetric(key: string, value: string | number | boolean) {
    this.metrics[key] = value;
  }
  // TODO
  // getWorldUVAtPosition(position: Vector3): Vector2 | null {
  //   // call quadtree get world uv at position
  //   // return the result
  // }

  // TODO
  // rayIntersection(ray: Ray) {
  //   // call quadtree raycast
  //   // return the result
  // }

  // TODO
  // queryHeightAtPosition(position: Vector3): number | null {
  //   // call quadtree get height at position
  //   // return the result
  //   return 0;
  // }

  // TODO
  // queryHeightAtWorldUV(worldUV: Vector2): number {
  //   // call quadtree get height at world uv
  //   // return the result
  //   return 0;
  // }

  destroy() {
    // destroy storage buffers and other resources
    // destroy quadtree
    this.quadtree.destroy();
  }
}
