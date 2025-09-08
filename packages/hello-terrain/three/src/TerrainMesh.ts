import {
  DynamicDrawUsage,
  InstancedMesh,
  type NodeMaterial,
  type Vector3,
} from "three/webgpu";
import { StorageBuffer } from "./compute/StorageBuffer";
import { TerrainGeometry } from "./geometry/TerrainGeometry";
import { tileData } from "./nodes/tile";
import { Quadtree, type QuadtreeParams } from "./quadtree/Quadtree";

export interface TerrainMeshParams extends Omit<QuadtreeParams, "origin"> {
  innerTileSegments: number;
  material?: NodeMaterial;
}

export class TerrainMesh extends InstancedMesh {
  quadtree: Quadtree;
  lastHash: number;
  metrics: Record<string, string | number | boolean>;
  public readonly nodeStorage: StorageBuffer;
  constructor(public readonly params: TerrainMeshParams) {
    const { innerTileSegments, material, ...quadtreeParams } = params;
    const geometry = new TerrainGeometry(params.innerTileSegments);
    super(geometry, material, quadtreeParams.maxNodes);
    this.quadtree = new Quadtree({
      ...quadtreeParams,
      origin: this.position,
    });
    this.instanceMatrix.setUsage(DynamicDrawUsage);
    this.count = quadtreeParams.maxNodes;
    this.instanceMatrix.needsUpdate = true;

    // const tileEdgeVertextCount = innerTileSegments + 1 + 2;
    this.nodeStorage = new StorageBuffer(
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
    console.log("TerrainMesh construced", this);
  }
  update(position: Vector3) {
    this.setMetric(
      "updatePosition",
      `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`
    );
    this.quadtree.update(position);
    // update compute shader nodes
    // update storage buffers

    if (this.quadtree.hasStateChanged(this.lastHash)) {
      const beforeHash = performance.now();
      this.lastHash = this.quadtree.getStateHash();
      const afterHash = performance.now();
      this.nodeStorage.update(
        this.quadtree.getNodeView().getBuffers().nodeBuffer
      );
      this.instanceMatrix.needsUpdate = true;
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

  tileDataFn = () => tileData(this.nodeStorage.storageNode);

  destroy() {
    // destroy storage buffers and other resources
    // destroy quadtree
    this.quadtree.destroy();
  }
}
