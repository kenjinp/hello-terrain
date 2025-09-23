import { float, int, vec3 } from "three/tsl";
import {
  InstancedMesh,
  type Material,
  type NodeMaterial,
  Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import { ComputeToBufferMap } from "./compute/ComputeToBufferMap";
import { StorageBuffer } from "./compute/StorageBuffer";
import { TerrainGeometry } from "./geometry/TerrainGeometry";
import { ElevationFn, type ElevationReturn } from "./nodes/ElevationFn";
import { height } from "./nodes/height";
import {} from "./nodes/tile";
import { uRootOrigin, uRootSize, uSegments } from "./nodes/uniforms";
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
  // @ts-ignore will be initialized
  private nodeStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private heightmapStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private normalmapStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private heightmapComputeShader: ComputeToBufferMap;
  public readonly params: TerrainMeshParams;
  constructor(params: Partial<TerrainMeshParams> = {}) {
    const defaults = {
      innerTileSegments: 13, // 16 total vertices per tile
      elevationFn: ElevationFn(() => float(0)),
      maxLevel: 10,
      rootSize: 100,
      minNodeSize: 1,
      subdivisionFactor: 2,
      maxNodes: 1000,
    } satisfies Omit<TerrainMeshParams, "material">;
    const merged: TerrainMeshParams = {
      ...defaults,
      ...params,
    } as TerrainMeshParams;

    const { innerTileSegments, material, ...quadtreeParams } = merged;
    const geometry = new TerrainGeometry(merged.innerTileSegments, true);
    // material may be set later by consumers; pass through if present
    super(geometry, material as unknown as Material, quadtreeParams.maxNodes);
    this.params = merged;
    this.quadtree = new Quadtree({
      ...quadtreeParams,
      origin: this.position.clone(),
    });

    this.lastHash = 0;
    this.metrics = {
      hashTime: 0,
      hash: 0,
      hasStateChanged: false,
      leafNodeCount: 0,
      nodeCount: 0,
    };

    const tileEdgeVertexCount = innerTileSegments + 1 + 2;
    if (tileEdgeVertexCount > 256) {
      throw new Error("innerTileSegments exceeds the maximum of 253");
    }

    uRootOrigin.value = this.position;
    uRootSize.value = this.params.rootSize;
    uSegments.value = this.params.innerTileSegments;

    this.initializeStorage();
    this.initializeComputeShaders();
  }

  get tileEdgeVertexCount() {
    return this.params.innerTileSegments + 2 + 1;
  }

  private initializeStorage(): {
    nodeStorage: StorageBuffer;
    heightmapStorage: StorageBuffer;
    normalmapStorage: StorageBuffer;
  } {
    const maxNodes = this.quadtree.getConfig().maxNodes;
    const nodeStorage = new StorageBuffer(
      "nodeStorage",
      this.quadtree.getNodeView().getBuffers().nodeBuffer,
      4,
      maxNodes
    );

    const tileEdgeVertexCount = this.params.innerTileSegments + 1 + 2;
    const computeTextureHeight = tileEdgeVertexCount;
    const computeTextureWidth = computeTextureHeight * maxNodes;
    const heightmapDimensions = computeTextureWidth * computeTextureHeight;
    const heightmapStorage = new StorageBuffer(
      "heightmapStorage",
      new Float32Array(heightmapDimensions).fill(1),
      1,
      maxNodes
    );
    const normalmapStorage = new StorageBuffer(
      "normalmapStorage",
      new Float32Array(heightmapDimensions * 3),
      3,
      maxNodes
    );

    this.nodeStorage = nodeStorage;
    this.heightmapStorage = heightmapStorage;
    this.normalmapStorage = normalmapStorage;

    return { nodeStorage, heightmapStorage, normalmapStorage };
  }

  private initializeComputeShaders(): ComputeToBufferMap {
    const tileEdgeVertexCount = this.params.innerTileSegments + 1 + 2;
    const shader = new ComputeToBufferMap(
      (nodeIndex, globalVertexIndex, localUV, _localCoordinates, texelSize) => {
        const origin = vec3(
          new Vector3(this.position.x, this.position.y, this.position.z)
        );

        const rootSize = float(this.params.rootSize).toVar();
        const h = height(
          nodeIndex,
          this.nodeStorage.storageNode,
          rootSize,
          origin,
          localUV,
          int(this.params.innerTileSegments),
          texelSize,
          this.params.elevationFn ?? ElevationFn(() => float(0))
        );
        this.heightmapStorage.storageNode.element(globalVertexIndex).assign(h);
      }
    );
    shader.createBinds(tileEdgeVertexCount, 1, this.heightmapStorage);
    this.heightmapComputeShader = shader;
    return shader;
  }

  set rootSize(size: number) {
    this.params.rootSize = size;
    uRootSize.value = size;
    const { innerTileSegments, material, ...quadtreeParams } = this.params;
    this.quadtree.setConfig({
      ...quadtreeParams,
      origin: this.position.clone(),
    });
  }

  get rootSize() {
    return this.params.rootSize;
  }

  set innerTileSegments(segments: number) {
    const tileEdgeVertexCount = segments + 1 + 2;
    if (tileEdgeVertexCount > 256) {
      throw new Error("innerTileSegments exceeds the maximum of 253");
    }

    this.params.innerTileSegments = segments;
    uSegments.value = segments;
    const { innerTileSegments, material, ...quadtreeParams } = this.params;
    this.quadtree.setConfig({
      ...quadtreeParams,
      origin: this.position.clone(),
    });
  }

  get innerTileSegments() {
    return this.params.innerTileSegments;
  }

  setMaterial(material: NodeMaterial) {
    this.params.material = material;
    // Assign to base InstancedMesh material
    (this as unknown as { material: Material | Material[] }).material =
      material as unknown as Material;
  }

  getMaterial(): NodeMaterial | undefined {
    return (
      this.params.material ??
      (this as unknown as { material?: NodeMaterial }).material
    );
  }

  set elevationFn(fn: ElevationReturn) {
    this.params.elevationFn = fn;
    this.heightmapComputeShader = this.initializeComputeShaders();
  }

  get elevationFn() {
    return this.params.elevationFn ?? ElevationFn(() => float(0));
  }

  set maxLevel(level: number) {
    this.params.maxLevel = level;
    const { innerTileSegments, material, ...quadtreeParams } = this.params;
    this.quadtree.setConfig({
      ...quadtreeParams,
      origin: this.position.clone(),
    });
  }

  get maxLevel() {
    return this.params.maxLevel;
  }

  set minNodeSize(size: number) {
    this.params.minNodeSize = size;
    const { innerTileSegments, material, ...quadtreeParams } = this.params;
    this.quadtree.setConfig({
      ...quadtreeParams,
      origin: this.position.clone(),
    });
  }

  get minNodeSize() {
    return this.params.minNodeSize;
  }

  set subdivisionFactor(factor: number) {
    this.params.subdivisionFactor = factor;
    const { innerTileSegments, material, ...quadtreeParams } = this.params;
    this.quadtree.setConfig({
      ...quadtreeParams,
      origin: this.position.clone(),
    });
  }

  get subdivisionFactor() {
    return this.params.subdivisionFactor;
  }

  set maxNodes(count: number) {
    this.params.maxNodes = count;
    const { innerTileSegments, material, ...quadtreeParams } = this.params;
    this.quadtree.setConfig({
      ...quadtreeParams,
      origin: this.position.clone(),
    });
    const storages = this.initializeStorage();
    this.nodeStorage = storages.nodeStorage;
    this.heightmapStorage = storages.heightmapStorage;
    this.normalmapStorage = storages.normalmapStorage;
    this.heightmapComputeShader = this.initializeComputeShaders();
  }

  get maxNodes() {
    return this.params.maxNodes;
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
      // const first100 = f32.subarray(0, Math.min(10, f32.length));

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

  get heightmapNode() {
    return this.heightmapStorage.storageNode;
  }

  get normalMapNode() {
    return this.normalmapStorage.storageNode;
  }

  get tileNode() {
    return this.nodeStorage.storageNode;
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
    console.log("destroy");
    // destroy storage buffers and other resources
    // destroy quadtree
    this.quadtree.destroy();
  }
}
