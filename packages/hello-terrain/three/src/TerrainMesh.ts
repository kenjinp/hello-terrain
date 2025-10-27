import { Vector2 as ThreeVector2, Vector3 as ThreeVector3 } from "three";
import type { Ray as ThreeRay } from "three";
import { float, int, max, min, vec3 } from "three/tsl";
import {
  InstancedMesh,
  type Material,
  type NodeMaterial,
  type Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import { ComputeToBufferMap } from "./compute/ComputeToBufferMap";
import { StorageBuffer } from "./compute/StorageBuffer";
import { TerrainGeometry } from "./geometry/TerrainGeometry";
import { ElevationFn, type ElevationReturn } from "./nodes/ElevationFn";
import { height } from "./nodes/height";
import {
  heightmapStorageProperty,
  nodeStorageProperty,
  normalmapStorageProperty,
} from "./nodes/properties";
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
  lastUpdateHeight: number | null = null;
  private needsRecompute = false;
  // Debounce/update control
  private isUpdateInFlight = false;
  private hasPendingUpdate = false;
  private pendingRenderer: WebGPURenderer | null = null;
  private pendingPosition: Vector3 | null = null;
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
      lastUpdateHeight: 0,
    };

    const tileEdgeVertexCount = innerTileSegments + 1 + 2;
    if (tileEdgeVertexCount > 256) {
      throw new Error("innerTileSegments exceeds the maximum of 253");
    }

    this.applyUniforms();
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

    const computeTextureHeight = this.tileEdgeVertexCount;
    const computeTextureWidth = computeTextureHeight * maxNodes;
    const heightmapDimensions = computeTextureWidth * computeTextureHeight;
    const heightmapStorage = new StorageBuffer(
      "heightmapStorage",
      new Float32Array(heightmapDimensions).fill(0),
      1,
      heightmapDimensions
    );

    nodeStorageProperty.value = nodeStorage.storageBufferAttribute;
    heightmapStorageProperty.value = heightmapStorage.storageBufferAttribute;

    const normalmapStorage = new StorageBuffer(
      "normalmapStorage",
      new Float32Array(heightmapDimensions * 3).fill(0),
      3,
      heightmapDimensions
    );

    this.nodeStorage = nodeStorage;
    this.heightmapStorage = heightmapStorage;
    this.normalmapStorage = normalmapStorage;

    normalmapStorageProperty.value = normalmapStorage.storageBufferAttribute;

    return { nodeStorage, heightmapStorage, normalmapStorage };
  }

  private initializeComputeShaders(): ComputeToBufferMap {
    // Ensure uniforms reflect current params before building compute nodes
    this.applyUniforms();
    const tileEdgeVertexCount = this.params.innerTileSegments + 1 + 2;
    const shader = new ComputeToBufferMap(
      (
        nodeIndex,
        globalVertexIndex,
        localUV,
        _localCoordinates,
        _texelSize
      ) => {
        const h = height(
          nodeIndex,
          localUV,
          _texelSize,
          this.params.elevationFn ?? ElevationFn(() => float(0))
        );
        this.heightmapStorage.storageNode.element(globalVertexIndex).assign(h);
      }
    );
    shader.createBinds(
      tileEdgeVertexCount,
      1,
      this.quadtree.getConfig().maxNodes,
      this.heightmapStorage
    );
    this.heightmapComputeShader = shader;
    return shader;
  }

  private async runNormalMapCompute(renderer: WebGPURenderer): Promise<void> {
    const beforeCompute = performance.now();
    const tileEdgeVertexCount = this.params.innerTileSegments + 1 + 2;
    const shader = new ComputeToBufferMap(
      (
        nodeIndex,
        globalVertexIndex,
        localUV,
        _localCoordinates,
        _texelSize
      ) => {
        // Finite differences on the height buffer to derive normals
        const iWidth = int(tileEdgeVertexCount);
        const last = iWidth.sub(int(1));

        const ix = localUV.x.mul(iWidth.toFloat()).floor().toInt();
        const iy = localUV.y.mul(iWidth.toFloat()).floor().toInt();

        const ixL = max(ix.sub(int(1)), int(0));
        const ixR = min(ix.add(int(1)), last);
        const iyD = max(iy.sub(int(1)), int(0));
        const iyU = min(iy.add(int(1)), last);

        const verticesPerNode = iWidth.mul(iWidth);
        const base = int(nodeIndex).mul(verticesPerNode);
        const idxL = base.add(iy.mul(iWidth).add(ixL));
        const idxR = base.add(iy.mul(iWidth).add(ixR));
        const idxD = base.add(iyD.mul(iWidth).add(ix));
        const idxU = base.add(iyU.mul(iWidth).add(ix));

        const hL = this.heightmapStorage.storageNode.element(idxL);
        const hR = this.heightmapStorage.storageNode.element(idxR);
        const hD = this.heightmapStorage.storageNode.element(idxD);
        const hU = this.heightmapStorage.storageNode.element(idxU);

        const dx = hR.sub(hL);
        const dz = hU.sub(hD);
        const n = vec3(dx.negate(), float(1), dz.negate()).normalize();

        const baseOut = int(globalVertexIndex).mul(int(3));
        this.normalmapStorage.storageNode
          .element(baseOut.add(int(0)))
          .assign(n.x);
        this.normalmapStorage.storageNode
          .element(baseOut.add(int(1)))
          .assign(n.y);
        this.normalmapStorage.storageNode
          .element(baseOut.add(int(2)))
          .assign(n.z);
      }
    );
    shader.createBinds(
      tileEdgeVertexCount,
      3,
      this.quadtree.getConfig().maxNodes,
      this.normalmapStorage
    );
    await shader.renderBind(renderer, this.normalmapStorage);
    const afterCompute = performance.now();
    this.setMetric("normalmapComputeTime", `${afterCompute - beforeCompute}ms`);
  }

  private applyUniforms(): void {
    uRootOrigin.value = this.position;
    uRootSize.value = this.params.rootSize;
    uSegments.value = this.params.innerTileSegments;
  }

  private updateQuadtreeConfig(): void {
    const {
      innerTileSegments: _s,
      material: _m,
      ...quadtreeParams
    } = this.params;
    this.quadtree.setConfig({
      ...quadtreeParams,
      origin: this.position.clone(),
    });
  }

  private validateInnerTileSegments(segments: number): void {
    const tileEdgeVertexCount = segments + 1 + 2;
    if (tileEdgeVertexCount > 256) {
      throw new Error("innerTileSegments exceeds the maximum of 253");
    }
  }

  private refreshNodeStorageFromQuadtree(): void {
    this.nodeStorage.update(
      this.quadtree.getNodeView().getBuffers().nodeBuffer
    );
  }

  private shouldRecompute(): boolean {
    return this.needsRecompute || this.quadtree.hasStateChanged(this.lastHash);
  }

  private async runHeightmapCompute(renderer: WebGPURenderer): Promise<void> {
    const beforeCompute = performance.now();
    this.refreshNodeStorageFromQuadtree();
    await this.heightmapComputeShader.renderBind(
      renderer,
      this.heightmapStorage
    );
    const afterCompute = performance.now();
    this.setMetric("heightmapComputeTime", `${afterCompute - beforeCompute}ms`);

    const beforeHash = performance.now();
    this.lastHash = this.quadtree.getStateHash();
    const afterHash = performance.now();
    this.setMetric("hashTime", `${(afterHash - beforeHash).toFixed(2)}ms`);
    this.setMetric("hash", this.lastHash.toString());
    this.setMetric("deepestLevel", this.quadtree.getDeepestLevel().toString());
    this.setMetric(
      "leafNodeCount",
      this.quadtree.getLeafNodeCount().toString()
    );
    this.setMetric("nodeCount", this.quadtree.getNodeCount().toString());
    this.setMetric("hasStateChanged", "true");
    this.needsRecompute = false;
  }

  set rootSize(size: number) {
    this.params.rootSize = size;
    this.applyUniforms();
    this.updateQuadtreeConfig();
    this.needsRecompute = true;
  }

  get rootSize() {
    return this.params.rootSize;
  }

  set innerTileSegments(segments: number) {
    this.validateInnerTileSegments(segments);

    this.geometry.dispose();
    this.geometry = new TerrainGeometry(segments, true);

    this.params.innerTileSegments = segments;
    this.applyUniforms();
    this.updateQuadtreeConfig();
    this.quadtree.reset();
    this.initializeStorage();
    this.initializeComputeShaders();
    this.needsRecompute = true;
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
    // Re-apply uniforms and rebuild compute shader to avoid stale layouts
    this.applyUniforms();
    this.heightmapComputeShader = this.initializeComputeShaders();
    this.needsRecompute = true;
  }

  get elevationFn() {
    return this.params.elevationFn ?? ElevationFn(() => float(0));
  }

  set maxLevel(level: number) {
    this.params.maxLevel = level;
    this.updateQuadtreeConfig();
    // Quadtree distribution may change on next update; force recompute
    this.needsRecompute = true;
  }

  get maxLevel() {
    return this.params.maxLevel;
  }

  set minNodeSize(size: number) {
    this.params.minNodeSize = size;
    this.updateQuadtreeConfig();
    this.needsRecompute = true;
  }

  get minNodeSize() {
    return this.params.minNodeSize;
  }

  set subdivisionFactor(factor: number) {
    this.params.subdivisionFactor = factor;
    this.updateQuadtreeConfig();
    this.needsRecompute = true;
  }

  get subdivisionFactor() {
    return this.params.subdivisionFactor;
  }

  set maxNodes(count: number) {
    this.params.maxNodes = count;
    this.updateQuadtreeConfig();
    const storages = this.initializeStorage();
    this.nodeStorage = storages.nodeStorage;
    this.heightmapStorage = storages.heightmapStorage;
    this.normalmapStorage = storages.normalmapStorage;
    this.heightmapComputeShader = this.initializeComputeShaders();
    this.needsRecompute = true;
  }

  get maxNodes() {
    return this.params.maxNodes;
  }

  async update(renderer: WebGPURenderer, position: Vector3) {
    // Always capture the latest call arguments
    this.pendingRenderer = renderer;
    // Reuse a single Vector3 instance to avoid allocations
    if (!this.pendingPosition) {
      this.pendingPosition = new ThreeVector3();
    }
    (this.pendingPosition as unknown as ThreeVector3).set(
      position.x,
      position.y,
      position.z
    );

    // If a compute is already in flight, mark that we have a pending update and exit early
    if (this.isUpdateInFlight) {
      this.hasPendingUpdate = true;
      return;
    }

    this.isUpdateInFlight = true;

    try {
      do {
        // Consume the latest pending args at the start of each cycle
        if (!this.pendingRenderer || !this.pendingPosition) {
          // Nothing to process
          break;
        }
        const currentRenderer = this.pendingRenderer;
        const currentPosition = this.pendingPosition;
        // Reset the pending flag; if another update() arrives during work, it will set this back to true
        this.hasPendingUpdate = false;

        // Update uniforms and quadtree using the latest position
        this.applyUniforms();
        this.setMetric(
          "updatePosition",
          `${currentPosition.x.toFixed(2)}, ${currentPosition.y.toFixed(2)}, ${currentPosition.z.toFixed(2)}`
        );
        const closestLeafIndex = this.quadtree.update(currentPosition);
        this.setMetric("closestLeafIndex", closestLeafIndex);

        // If recompute is needed or quadtree state changed, run the compute pass
        if (this.shouldRecompute()) {
          await this.runHeightmapCompute(currentRenderer);
          await this.runNormalMapCompute(currentRenderer);
        } else {
          this.setMetric("hasStateChanged", "false");
        }

        // After compute (or if not needed), sample height at the current position
        const localUV = this.worldToLocalUV(
          closestLeafIndex,
          currentPosition as unknown as ThreeVector3
        );
        this.lastUpdateHeight = this.sampleHeightFromBuffer(
          closestLeafIndex,
          localUV.x,
          localUV.y
        );
        this.setMetric("lastUpdateHeight", this.lastUpdateHeight);
        // Loop again if another update was queued while we were computing
      } while (this.hasPendingUpdate);
    } finally {
      this.isUpdateInFlight = false;
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

  // Returns world-UV within the root tile for the given world-space position, or null if out of bounds.
  getWorldUVAtPosition(position: Vector3): ThreeVector2 | null {
    const { rootSize } = this.params;
    const half = 0.5 * rootSize;
    const minX = this.position.x - half;
    const minZ = this.position.z - half;
    const maxX = minX + rootSize;
    const maxZ = minZ + rootSize;

    // Reject when outside the root tile bounds in XZ
    if (
      position.x < minX ||
      position.x > maxX ||
      position.z < minZ ||
      position.z > maxZ
    ) {
      return null;
    }

    // Map world XZ to [0,1] range across the root tile
    const u = (position.x - minX) / rootSize;
    const v = (position.z - minZ) / rootSize;
    return new ThreeVector2(u, v);
  }

  // Intersect a ray with the height field using sampling + binary refinement. Returns hit point and t, or null.
  rayIntersection(ray: ThreeRay): { point: ThreeVector3; t: number } | null {
    const { rootSize } = this.params;
    const half = 0.5 * rootSize;

    // Axis-aligned XZ bounds of the terrain root
    const minX = this.position.x - half;
    const minZ = this.position.z - half;
    const maxX = minX + rootSize;
    const maxZ = minZ + rootSize;

    // March along the ray with a conservative step in world units
    const maxSteps = 256;
    const step = rootSize / 64;

    // Start a bit in front of the origin to avoid self-intersections
    let t = 0;
    let prevT = t;
    let prevVal: number | null = null;
    const tmp = new ThreeVector3();

    for (let i = 0; i < maxSteps; i++) {
      const p = ray.at(t, tmp);
      // Skip samples outside the XZ bounds
      if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ) {
        const h = this.queryHeightAtPosition(p);
        if (h != null) {
          const val = p.y - h; // sign indicates whether we're above (>0) or below (<0) the surface
          if (prevVal !== null && val * prevVal <= 0) {
            // Sign change: refine between prevT and t
            let a = prevT;
            let b = t;
            for (let it = 0; it < 20; it++) {
              const m = 0.5 * (a + b);
              const pm = ray.at(m, tmp);
              const hm = this.queryHeightAtPosition(pm);
              if (hm == null) break;
              const fm = pm.y - hm;
              if (prevVal * fm <= 0) {
                b = m;
              } else {
                a = m;
                prevVal = fm;
                prevT = m;
              }
            }
            const hitT = 0.5 * (a + b);
            const hit = ray.at(hitT, new ThreeVector3());
            return { point: hit, t: hitT };
          }
          prevVal = val;
          prevT = t;
        }
      }
      t += step;
    }
    return null;
  }

  // Returns the sampled height at a world position using the current heightmap buffer, or null if no leaf covers it.
  queryHeightAtPosition(position: Vector3): number | null {
    const nodeIndex = this.findLeafNodeIndexAt(
      position as unknown as ThreeVector3
    );
    if (nodeIndex == null) return null;
    const uv = this.worldToLocalUV(
      nodeIndex,
      position as unknown as ThreeVector3
    );
    return this.sampleHeightFromBuffer(nodeIndex, uv.x, uv.y);
  }

  // Returns height at a root-space world UV (0..1), clamped into domain.
  queryHeightAtWorldUV(worldUV: ThreeVector2): number {
    const clampedU = Math.min(Math.max(worldUV.x, 0), 1);
    const clampedV = Math.min(Math.max(worldUV.y, 0), 1);
    const { rootSize } = this.params;
    const minX = this.position.x - 0.5 * rootSize;
    const minZ = this.position.z - 0.5 * rootSize;
    const world = new ThreeVector3(
      minX + clampedU * rootSize,
      this.position.y,
      minZ + clampedV * rootSize
    );
    const h = this.queryHeightAtPosition(world);
    return h == null ? this.position.y : h;
  }

  // Find the index of the leaf quadtree node that contains the given world position (XZ), or null if none.
  private findLeafNodeIndexAt(world: ThreeVector3): number | null {
    const nodeView = this.quadtree.getNodeView();
    const nodeCount = this.quadtree.getNodeCount();
    for (let i = 0; i < nodeCount; i++) {
      if (!nodeView.getLeaf(i)) continue;
      const level = nodeView.getLevel(i);
      const size = this.params.rootSize / (1 << level);
      const x = nodeView.getX(i);
      const y = nodeView.getY(i);
      const minX = this.position.x + (x * size - 0.5 * this.params.rootSize);
      const minZ = this.position.z + (y * size - 0.5 * this.params.rootSize);
      if (
        world.x >= minX &&
        world.x <= minX + size &&
        world.z >= minZ &&
        world.z <= minZ + size
      ) {
        return i;
      }
    }
    return null;
  }

  // Compute local UV (0..1) within a specific node tile for a given world position.
  private worldToLocalUV(nodeIndex: number, world: ThreeVector3): ThreeVector2 {
    const nodeView = this.quadtree.getNodeView();
    const level = nodeView.getLevel(nodeIndex);
    const size = this.params.rootSize / (1 << level);
    const x = nodeView.getX(nodeIndex);
    const y = nodeView.getY(nodeIndex);
    const minX = this.position.x + (x * size - 0.5 * this.params.rootSize);
    const minZ = this.position.z + (y * size - 0.5 * this.params.rootSize);
    const u = (world.x - minX) / size;
    const v = (world.z - minZ) / size;
    return new ThreeVector2(
      Math.min(Math.max(u, 0), 1),
      Math.min(Math.max(v, 0), 1)
    );
  }

  // Bilinearly sample the heightmap buffer for a node at local UV. Assumes per-node packed N*N floats.
  private sampleHeightFromBuffer(
    nodeIndex: number,
    u: number,
    v: number
  ): number {
    const N = this.tileEdgeVertexCount;
    const x = u * (N - 1);
    const y = v * (N - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, N - 1);
    const y1 = Math.min(y0 + 1, N - 1);
    const tx = x - x0;
    const ty = y - y0;

    const perNode = N * N;
    const base = nodeIndex * perNode;
    const idx = (ix: number, iy: number) => base + iy * N + ix;

    const arr = this.heightmapStorage.storageBufferAttribute
      .array as Float32Array;
    const h00 = arr[idx(x0, y0)];
    const h10 = arr[idx(x1, y0)];
    const h01 = arr[idx(x0, y1)];
    const h11 = arr[idx(x1, y1)];

    return (
      (1 - tx) * (1 - ty) * h00 +
      tx * (1 - ty) * h10 +
      (1 - tx) * ty * h01 +
      tx * ty * h11
    );
  }

  destroy() {
    // destroy storage buffers and other resources
    // destroy quadtree
    this.quadtree.destroy();
  }
}
