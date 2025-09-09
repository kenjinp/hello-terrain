import {
  InstancedMesh,
  type NodeMaterial,
  type Texture,
  type Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import { ComputeShader } from "./compute/ComputeToTexture";
import { StorageBuffer } from "./compute/StorageBuffer";
import { TerrainGeometry } from "./geometry/TerrainGeometry";
import { floatToRG } from "./nodes/RGtexture";
import { Quadtree, type QuadtreeParams } from "./quadtree/Quadtree";
import { RGTexture } from "./texture/RGTexture";

export interface TerrainMeshParams extends Omit<QuadtreeParams, "origin"> {
  innerTileSegments: number;
  material?: NodeMaterial;
}

export class TerrainMesh extends InstancedMesh {
  quadtree: Quadtree;
  lastHash: number;
  metrics: Record<string, string | number | boolean>;
  public readonly nodeStorage: StorageBuffer;
  private heightmapComputeShader: ComputeShader;
  public readonly heightmapTexture: Texture;
  constructor(public readonly params: TerrainMeshParams) {
    const { innerTileSegments, material, ...quadtreeParams } = params;
    const geometry = new TerrainGeometry(params.innerTileSegments);
    super(geometry, material, quadtreeParams.maxNodes);
    this.quadtree = new Quadtree({
      ...quadtreeParams,
      origin: this.position.clone(),
    });

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

    const tileEdgeVertexCount = innerTileSegments + 1 + 2;
    const computeTextureHeight = tileEdgeVertexCount;
    const computeTextureWidth = computeTextureHeight * quadtreeParams.maxNodes;
    this.heightmapTexture = new RGTexture(
      computeTextureWidth,
      computeTextureHeight
    );
    this.heightmapComputeShader = new ComputeShader(
      (_pixelPos, _uvPos, textelSize) => {
        return floatToRG(textelSize);
      }
    );
    this.heightmapComputeShader.createBinds(
      computeTextureWidth,
      computeTextureHeight,
      this.heightmapTexture
    );

    console.log("TerrainMesh constructed", this);
  }
  update(renderer: WebGPURenderer, position: Vector3) {
    this.setMetric(
      "updatePosition",
      `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`
    );
    this.quadtree.update(position);
    // update compute shader nodes
    // update storage buffers

    if (this.quadtree.hasStateChanged(this.lastHash)) {
      this.heightmapComputeShader.renderBind(renderer, this.heightmapTexture);
      const beforeHash = performance.now();
      this.lastHash = this.quadtree.getStateHash();
      const afterHash = performance.now();
      this.nodeStorage.update(
        this.quadtree.getNodeView().getBuffers().nodeBuffer
      );
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
