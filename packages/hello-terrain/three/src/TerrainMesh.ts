import type { Ray as ThreeRay } from "three";
import { Vector2 as ThreeVector2, Vector3 as ThreeVector3 } from "three";
import {
  Fn,
  If,
  float,
  globalId,
  int,
  min,
  select,
  uint,
  uniform,
} from "three/tsl";
import {
  type Frustum,
  InstancedMesh,
  type Material,
  type NodeMaterial,
  type Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import { TerrainUniforms } from "./TerrainUniforms";
import { TerrainVaryings } from "./TerrainVaryings";
import { ComputeDAG } from "./compute/ComputeDAG";
import { ComputeToBufferMap } from "./compute/ComputeToBufferMap";
import { ControlDataPacker } from "./compute/ControlStorage";
import { StorageBuffer } from "./compute/StorageBuffer";
import {
  createControlmapStage,
  createHeightmapStage,
  createNormalmapStage,
} from "./compute/stages";
import { TerrainGeometry } from "./geometry/TerrainGeometry";
import type { ControlReturn } from "./nodes/ControlFn";
import { ElevationFn, type ElevationReturn } from "./nodes/ElevationFn";
import { createWorldPosition } from "./nodes/position";
import {
  activeLeafIndicesStorageProperty,
  controlmapStorageProperty,
  heightmapStorageProperty,
  nodeStorageProperty,
  normalmapStorageProperty,
} from "./nodes/properties";
import { createTileIsLeaf } from "./nodes/tile";
import {
  Quadtree,
  type QuadtreeParams,
  type SubdivisionStrategy,
  distanceBasedSubdivision,
} from "./quadtree/Quadtree";
import type { TerrainTextureArray } from "./texture/TerrainTextureArray";

export interface TerrainReadbackTickOptions {
  /**
   * Max tiles to read back per tick. Each tile readback performs:
   * - 1 compute dispatch (GPU copy tile -> small buffer)
   * - 1 GPU->CPU transfer (getArrayBufferAsync)
   *
   * @default 1
   */
  maxTilesPerTick?: number;
  /**
   * Max number of tiles to keep in the CPU cache (LRU).
   * @default 256
   */
  maxCacheTiles?: number;
  /**
   * If true, enqueue the current active leaves for readback over time.
   * @default true
   */
  includeActiveLeaves?: boolean;
  /**
   * If true, prioritize the camera tile (closest leaf) for readback.
   * @default true
   */
  includeCameraTile?: boolean;
  /**
   * If true, also enqueue neighboring tiles around the camera tile (only among active leaves).
   * @default true
   */
  includeCameraNeighbors?: boolean;
  /**
   * Neighbor radius in tile coordinates at the same quadtree level.
   * @default 1
   */
  neighborRadius?: number;
}

export interface TerrainMeshParams extends Omit<QuadtreeParams, "origin"> {
  innerTileSegments: number;
  material?: NodeMaterial;
  elevationFn?: ElevationReturn;
  /**
   * TSL function that computes control map data (texture IDs, blend, etc.)
   * in a compute shader. Receives height and normal data as inputs.
   * If not provided, control map uses defaultTextureId with no blending.
   */
  controlFn?: ControlReturn;
  /**
   * Minimum position change (in world units) required to trigger an update.
   * If the camera moves less than this distance from the last update position,
   * the update is skipped. Set to 0 to update on every frame.
   * @default 0.01
   */
  epsilon?: number;
  /**
   * Default texture ID to use for control map initialization
   * @default 0
   */
  defaultTextureId?: number;
  /**
   * Texture array for multi-texture terrain rendering
   */
  textureArray?: TerrainTextureArray;
  /**
   * Whether quadtree updates should use frustum culling.
   * When disabled, LOD selection and active tiles are determined only by distance/size rules.
   * @default true
   */
  frustumCulling?: boolean;
  /**
   * Simple distance-based subdivision factor.
   * Subdivides when: distance < nodeSize * subdivisionFactor
   * For more control, use `subdivisionStrategy` instead.
   * @default 2
   */
  subdivisionFactor?: number;
  /**
   * Subdivision strategy function that determines when to subdivide tiles.
   * Use the built-in strategies or provide your own:
   * - `distanceBasedSubdivision(factor)` - Original behavior, subdivide when close
   * - `screenSpaceSubdivision(options)` - Subdivide based on screen-space triangle size
   *
   * If not provided, uses `distanceBasedSubdivision(subdivisionFactor)`.
   *
   * @example
   * ```ts
   * import { screenSpaceSubdivision, computeScreenSpaceInfo } from '@hello-terrain/three';
   *
   * const terrain = new TerrainMesh({
   *   subdivisionStrategy: screenSpaceSubdivision({
   *     targetTrianglePixels: 6,
   *     tileSegments: 13,
   *     getScreenSpaceInfo: () => computeScreenSpaceInfo(
   *       camera.fov * Math.PI / 180,
   *       renderer.domElement.height
   *     )
   *   })
   * });
   * ```
   */
  subdivisionStrategy?: SubdivisionStrategy;
}

export class TerrainMesh extends InstancedMesh {
  quadtree: Quadtree;
  lastHash: number;
  metrics: Record<string, string | number | boolean>;
  lastUpdateHeight: number | null = null;
  /**
   * Indicates whether valid *tile* height data is available for CPU queries.
   *
   * Note: CPU height data is populated via `readbackTick()` (outside `update()`).
   * The cache is per-tile and incremental: a query may return `null` until the
   * relevant tile has been read back.
   */
  public hasValidHeightData = false;
  private needsRecompute = false;
  // Instance-specific uniforms and varyings
  public readonly uniforms: TerrainUniforms;
  public readonly varyings: TerrainVaryings;
  // Debounce/update control
  private isUpdateInFlight = false;
  private hasPendingUpdate = false;
  private pendingRenderer: WebGPURenderer | null = null;
  private pendingPosition: Vector3 | null = null;
  private pendingFrustum: Frustum | null = null;
  // @ts-ignore will be initialized
  private nodeStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private heightmapStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private normalmapStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private activeLeafIndicesStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private controlmapStorage: StorageBuffer;
  /** Compute pipeline DAG (user-extensible). */
  public dag!: ComputeDAG;
  // Readback pipeline: single-float buffer and uniforms to sample height on GPU
  // @ts-ignore will be initialized
  private lastUpdateHeightStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private lastUpdateHeightComputeShader: ComputeToBufferMap;
  // @ts-ignore will be initialized
  private uSampleNodeIndex: ReturnType<typeof uniform>;
  // @ts-ignore will be initialized
  private uSampleU: ReturnType<typeof uniform>;
  // @ts-ignore will be initialized
  private uSampleV: ReturnType<typeof uniform>;
  // Cached views to avoid per-frame allocations on readback
  private lastUpdateHeightView: Float32Array | null = null;
  // @ts-ignore
  private lastUpdateHeightDataView: DataView | null = null;
  // CPU-side per-tile height cache (N*N floats including skirt ring), keyed by nodeIndex.
  // We use Map insertion order as an LRU (delete+set on touch).
  private cpuTileHeights: Map<number, Float32Array> = new Map();
  private maxCpuTileHeights = 256;
  // Readback scheduling state (all readback happens outside `update()`).
  private tileReadbackQueue: number[] = [];
  private tileReadbackQueued: Set<number> = new Set();
  private isReadbackInFlight = false;
  private lastClosestLeafIndex: number | null = null;
  private lastActiveLeafIndices: Uint16Array | null = null;
  private lastActiveLeafCount = 0;
  private lastKnownCameraHeight = 0;
  private lastUpdatePosition: ThreeVector3 | null = null;
  // Reusable vector for terrain-aware LOD position adjustment
  private _adjustedPositionForLOD = new ThreeVector3();
  public readonly params: TerrainMeshParams;
  public textureArray?: TerrainTextureArray;
  // Tile readback pipeline: per-tile buffer and uniform to select node
  // @ts-ignore will be initialized
  private tileReadbackStorage: StorageBuffer;
  // @ts-ignore will be initialized
  private tileReadbackComputeNode: ComputeNode;
  // @ts-ignore will be initialized
  private tileReadbackDispatchSize: [number, number, number];
  // @ts-ignore will be initialized
  private uTileReadbackNodeIndex: ReturnType<typeof uniform>;
  constructor(params: Partial<TerrainMeshParams> = {}) {
    const defaults = {
      innerTileSegments: 13, // 16 total vertices per tile
      elevationFn: ElevationFn(() => float(0)),
      maxLevel: 10,
      rootSize: 100,
      minNodeSize: 1,
      maxNodes: 1000,
      frustumCulling: true,
      subdivisionFactor: 2,
    } satisfies Omit<TerrainMeshParams, "material" | "subdivisionStrategy">;
    const merged: TerrainMeshParams = {
      ...defaults,
      ...params,
    } as TerrainMeshParams;

    const {
      innerTileSegments,
      material,
      subdivisionStrategy,
      subdivisionFactor,
      ...quadtreeParams
    } = merged;

    // Use explicit strategy if provided, otherwise create from subdivisionFactor
    const effectiveStrategy =
      subdivisionStrategy ?? distanceBasedSubdivision(subdivisionFactor ?? 2);

    const geometry = new TerrainGeometry(merged.innerTileSegments, true);
    // material may be set later by consumers; pass through if present
    super(geometry, material as unknown as Material, quadtreeParams.maxNodes);
    // @ts-ignore
    this.params = merged;
    this.params.epsilon =
      params.epsilon ?? this.params.minNodeSize / this.params.innerTileSegments;

    // Disable Three.js's built-in frustum culling on the mesh.
    // The geometry's bounding sphere doesn't account for GPU vertex displacement
    // from the heightmap, so Three.js would incorrectly cull the terrain.
    // We use our own quadtree-based frustum culling instead (this.params.frustumCulling).
    (this as InstancedMesh).frustumCulled = false;
    this.quadtree = new Quadtree(
      {
        ...quadtreeParams,
        origin: this.position.clone(),
      },
      effectiveStrategy
    );

    // Initialize instance-specific uniforms and varyings
    this.uniforms = new TerrainUniforms({
      rootSize: merged.rootSize,
      innerTileSegments: merged.innerTileSegments,
      instanceId: this.uuid,
    });
    this.varyings = new TerrainVaryings(this.uuid);

    // Set texture array if provided
    this.textureArray = params.textureArray;

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
    this.initializeComputeDAG();
    this.initializeReadbackCompute();
  }

  get tileEdgeVertexCount() {
    return this.params.innerTileSegments + 2 + 1;
  }

  private initializeStorage(): void {
    const maxNodes = this.quadtree.getConfig().maxNodes;
    const nodeStorage = new StorageBuffer(
      "nodeStorage",
      this.quadtree.getNodeView().getBuffers().nodeBuffer,
      4,
      maxNodes
    );
    nodeStorageProperty.value = nodeStorage.storageBufferAttribute;
    this.nodeStorage = nodeStorage;

    // Create storage buffer for active leaf indices (used for indirection in optimized compute)
    const activeLeafIndicesStorage = new StorageBuffer(
      "activeLeafIndicesStorage",
      new Uint16Array(maxNodes),
      1,
      maxNodes
    );
    this.activeLeafIndicesStorage = activeLeafIndicesStorage;
    activeLeafIndicesStorageProperty.value =
      activeLeafIndicesStorage.storageBufferAttribute;
  }

  private initializeComputeDAG(): void {
    const tileEdgeVertexCount = this.tileEdgeVertexCount;

    this.dag = new ComputeDAG({
      maxNodes: this.params.maxNodes,
      tileEdgeVertexCount,
      uniforms: this.uniforms,
      activeLeafIndicesStorage: this.activeLeafIndicesStorage,
    });

    // Heightmap stage
    this.dag.addStage(
      createHeightmapStage({
        setMetric: (name, value) => {
          this.metrics[name] = value;
        },
        uniforms: this.uniforms,
        elevationFn: this.params.elevationFn ?? ElevationFn(() => float(0)),
      })
    );

    // Normalmap stage
    this.dag.addStage(
      createNormalmapStage({
        setMetric: (name, value) => {
          this.metrics[name] = value;
        },
        uniforms: this.uniforms,
        tileEdgeVertexCount,
        heightInputStage: "heightmap",
      })
    );

    // Controlmap stage (always present so the render path always has a buffer bound)
    if (this.params.controlFn) {
      this.dag.addStage(
        createControlmapStage({
          setMetric: (name, value) => {
            this.metrics[name] = value;
          },
          uniforms: this.uniforms,
          controlFn: this.params.controlFn,
          heightInputStage: "heightmap",
          normalInputStage: "normalmap",
        })
      );
    } else {
      // Default: fill with the packed default texture id.
      const defaultPacked = ControlDataPacker.pack({
        baseTextureId: this.params.defaultTextureId ?? 0,
        overlayTextureId: 0,
        blend: 0,
      });
      const tileIsLeaf = createTileIsLeaf();
      this.dag.addStage({
        name: "controlmap",
        inputs: [],
        output: { components: 1, type: Uint32Array, name: "controlmapStorage" },
        compute: (ctx) => {
          const isActive = nodeStorageProperty
            .element(ctx.nodeIndex.mul(4).add(3))
            .equal(int(1));
          const isLeaf = tileIsLeaf(ctx.nodeIndex);
          ctx.output
            .element(ctx.globalVertexIndex)
            .assign(select(isActive.and(isLeaf), uint(defaultPacked), uint(0)));
        },
      });
    }

    // Cache references for internal helpers/readback
    this.heightmapStorage = this.dag.getOutput("heightmap");
    this.normalmapStorage = this.dag.getOutput("normalmap");
    this.controlmapStorage = this.dag.getOutput("controlmap");

    // Wire stage outputs into render-time storage properties
    heightmapStorageProperty.value =
      this.heightmapStorage.storageBufferAttribute;
    normalmapStorageProperty.value =
      this.normalmapStorage.storageBufferAttribute;
    controlmapStorageProperty.value =
      this.controlmapStorage.storageBufferAttribute;

    // Reset CPU tile cache because the GPU buffers have been recreated
    this.cpuTileHeights.clear();
    this.hasValidHeightData = false;
  }

  private initializeReadbackCompute(): void {
    // Single-float storage buffer to receive sampled height from GPU
    this.lastUpdateHeightStorage = new StorageBuffer(
      "lastUpdateHeightStorage",
      new Float32Array(1).fill(0),
      1,
      1
    );
    // Create a reusable CPU-side view for the single float
    if (!this.lastUpdateHeightView) {
      this.lastUpdateHeightView = new Float32Array(1);
    }

    // Uniforms to drive which node/UV to sample
    this.uSampleNodeIndex = uniform(0).setName("uSampleNodeIndex");
    this.uSampleU = uniform(0).setName("uSampleU");
    this.uSampleV = uniform(0).setName("uSampleV");

    const tileEdgeVertexCount = this.params.innerTileSegments + 1 + 2;

    // ------------------------------------------------------------
    // Option 4: partial/tile readback
    // Read back only the height tile under the camera (N*N floats ~18KB at N=67).
    // ------------------------------------------------------------
    const tileTexelCount = tileEdgeVertexCount * tileEdgeVertexCount;
    this.tileReadbackStorage = new StorageBuffer(
      "tileReadbackStorage",
      new Float32Array(tileTexelCount).fill(0),
      1,
      tileTexelCount
    );
    this.uTileReadbackNodeIndex = uniform(0).setName("uTileReadbackNodeIndex");

    const wgX = 16;
    const wgY = 16;
    const dispatchX = Math.ceil(tileEdgeVertexCount / wgX);
    const dispatchY = Math.ceil(tileEdgeVertexCount / wgY);
    this.tileReadbackDispatchSize = [dispatchX, dispatchY, 1];

    this.tileReadbackComputeNode = Fn(() => {
      const N = int(tileEdgeVertexCount);
      const ix = int(globalId.x);
      const iy = int(globalId.y);
      If(ix.lessThan(N).and(iy.lessThan(N)), () => {
        const nodeIndex = int(this.uTileReadbackNodeIndex);
        const perNode = N.mul(N);
        const srcIndex = nodeIndex.mul(perNode).add(iy.mul(N).add(ix));
        const dstIndex = iy.mul(N).add(ix);
        this.tileReadbackStorage.storageNode
          .element(dstIndex)
          .assign(this.heightmapStorage.storageNode.element(srcIndex));
      });
    })().computeKernel([wgX, wgY, 1]);

    // Compute to read bilinear sample from heightmapStorage into lastUpdateHeightStorage[0]
    const shader = new ComputeToBufferMap(
      (
        _nodeIndex,
        globalVertexIndex,
        _localUV,
        _localCoordinates,
        _texelSize
      ) => {
        const iWidth = int(tileEdgeVertexCount);
        const last = iWidth.sub(int(1));

        // Read uniforms
        const nodeIndex = int(this.uSampleNodeIndex);
        const u = this.uSampleU;
        const v = this.uSampleV;

        // Map UV to grid coordinates in [0, N-1]
        const fWidth = iWidth.toFloat();
        const x = u.mul(fWidth.sub(float(1)));
        const y = v.mul(fWidth.sub(float(1)));
        const x0 = x.floor().toInt();
        const y0 = y.floor().toInt();
        const x1 = min(x0.add(int(1)), last);
        const y1 = min(y0.add(int(1)), last);

        const tx = x.sub(x0.toFloat());
        const ty = y.sub(y0.toFloat());

        const verticesPerNode = iWidth.mul(iWidth);
        const base = nodeIndex.mul(verticesPerNode);
        const idx00 = base.add(y0.mul(iWidth).add(x0));
        const idx10 = base.add(y0.mul(iWidth).add(x1));
        const idx01 = base.add(y1.mul(iWidth).add(x0));
        const idx11 = base.add(y1.mul(iWidth).add(x1));

        const h00 = this.heightmapStorage.storageNode.element(idx00);
        const h10 = this.heightmapStorage.storageNode.element(idx10);
        const h01 = this.heightmapStorage.storageNode.element(idx01);
        const h11 = this.heightmapStorage.storageNode.element(idx11);

        const h = h00
          .mul(float(1).sub(tx).mul(float(1).sub(ty)))
          .add(h10.mul(tx).mul(float(1).sub(ty)))
          .add(h01.mul(float(1).sub(tx)).mul(ty))
          .add(h11.mul(tx).mul(ty));

        // Write sampled height to output buffer (single element)
        this.lastUpdateHeightStorage.storageNode
          .element(globalVertexIndex)
          .assign(h);
      }
    );

    // Width=1, components=1, instances=1 (single value output)
    shader.createBinds(1, 1, 1, this.lastUpdateHeightStorage);
    this.lastUpdateHeightComputeShader = shader;
  }

  private applyUniforms(): void {
    this.uniforms.update(
      this.position,
      this.params.rootSize,
      this.params.innerTileSegments
    );
  }

  private updateQuadtreeConfig(): void {
    const {
      innerTileSegments: _s,
      material: _m,
      subdivisionStrategy: _ss,
      subdivisionFactor: _sf,
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
    this.initializeComputeDAG();
    this.initializeReadbackCompute();
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
    this.applyUniforms();
    this.initializeStorage();
    this.initializeComputeDAG();
    this.initializeReadbackCompute();
    this.needsRecompute = true;
  }

  get elevationFn() {
    return this.params.elevationFn ?? ElevationFn(() => float(0));
  }

  set controlFn(fn: ControlReturn | undefined) {
    this.params.controlFn = fn;
    this.applyUniforms();
    this.initializeStorage();
    this.initializeComputeDAG();
    this.initializeReadbackCompute();
    this.needsRecompute = true;
  }

  get controlFn() {
    return this.params.controlFn;
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

  /**
   * Set the subdivision strategy.
   * Use built-in strategies like `distanceBasedSubdivision()` or `screenSpaceSubdivision()`,
   * or provide your own custom strategy function.
   */
  set subdivisionStrategy(strategy: SubdivisionStrategy) {
    this.params.subdivisionStrategy = strategy;
    this.quadtree.setSubdivisionStrategy(strategy);
    this.needsRecompute = true;
  }

  /**
   * Get the current subdivision strategy
   */
  get subdivisionStrategy(): SubdivisionStrategy {
    return this.params.subdivisionStrategy ?? distanceBasedSubdivision(2);
  }

  /**
   * Set the subdivision factor (simple distance-based LOD).
   * This is a convenience setter that creates a distanceBasedSubdivision strategy.
   * For more control, use `subdivisionStrategy` directly.
   */
  set subdivisionFactor(factor: number) {
    this.params.subdivisionFactor = factor;
    // Only update strategy if not using a custom strategy
    if (!this.params.subdivisionStrategy) {
      this.quadtree.setSubdivisionStrategy(distanceBasedSubdivision(factor));
      this.needsRecompute = true;
    }
  }

  /**
   * Get the current subdivision factor
   */
  get subdivisionFactor(): number {
    return this.params.subdivisionFactor ?? 2;
  }

  set maxNodes(count: number) {
    this.params.maxNodes = count;
    this.updateQuadtreeConfig();
    this.initializeStorage();
    this.initializeComputeDAG();
    this.initializeReadbackCompute();
    this.needsRecompute = true;
  }

  get maxNodes() {
    return this.params.maxNodes;
  }

  set epsilon(value: number) {
    this.params.epsilon = value;
  }

  get epsilon() {
    return this.params.epsilon ?? 0.01;
  }

  set frustumCulling(enabled: boolean) {
    this.params.frustumCulling = enabled;
    // Ensure the next update isn't skipped due to epsilon and that GPU buffers can refresh.
    this.lastUpdatePosition = null;
    this.needsRecompute = true;
  }

  get frustumCulling() {
    return this.params.frustumCulling ?? true;
  }

  /**
   * Force the terrain to recompute heightmap, normalmap, and controlmap
   * on the next update. Useful when external textures (like a paint texture)
   * have been modified and need to be re-sampled by the compute shaders.
   */
  invalidate(): void {
    // Mark all compute stages dirty so they rerun on next update().
    // (This is intentionally coarse; callers can use `terrain.dag.invalidate('controlmap')`
    // for finer-grained invalidation.)
    if (this.dag) {
      this.dag.invalidateAll();
    }
    this.needsRecompute = true;
  }

  update(renderer: WebGPURenderer, position: Vector3, frustum: Frustum) {
    // Check if position change is below epsilon threshold - skip update if so
    const epsilon = this.params.epsilon ?? 0.0;
    if (epsilon > 0 && this.lastUpdatePosition) {
      // Don't skip when we have pending compute work (e.g., texture painting invalidated controlmap).
      const hasPendingCompute =
        this.needsRecompute || (this.dag?.isDirty() ?? false);
      // Use Three.js Vector3 method .distanceToSquared
      if (
        !hasPendingCompute &&
        position.distanceToSquared(this.lastUpdatePosition) < epsilon * epsilon
      ) {
        return;
      }
    }

    // Store the position for next frame's epsilon check
    if (!this.lastUpdatePosition) {
      this.lastUpdatePosition = new ThreeVector3();
    }
    this.lastUpdatePosition.set(position.x, position.y, position.z);

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
    this.pendingFrustum = frustum;

    // If a compute is already in flight, mark that we have a pending update and exit early
    if (this.isUpdateInFlight) {
      this.hasPendingUpdate = true;
      return;
    }

    this.isUpdateInFlight = true;

    const beforeUpdate = performance.now();
    try {
      do {
        // Consume the latest pending args at the start of each cycle
        if (!this.pendingRenderer || !this.pendingPosition) {
          // Nothing to process
          break;
        }
        const currentRenderer = this.pendingRenderer;
        const currentPosition = this.pendingPosition;
        const currentFrustum = this.pendingFrustum;
        // Reset the pending flag; if another update() arrives during work, it will set this back to true
        this.hasPendingUpdate = false;

        // Update uniforms and quadtree using the latest position
        this.applyUniforms();

        const useFrustum = this.frustumCulling
          ? (currentFrustum ?? undefined)
          : undefined;

        // TERRAIN-AWARE SUBDIVISION:
        // Sample terrain height at camera XZ BEFORE quadtree.update() resets the structure.
        // This uses the previous frame's stable quadtree to get a reliable height.
        const terrainHeight = this.sampleTerrainHeightStable(
          currentPosition as unknown as ThreeVector3
        );

        // Calculate height above terrain surface
        const heightAboveTerrain = currentPosition.y - terrainHeight;

        // Create adjusted position for LOD calculation:
        // Y = origin.y + heightAboveTerrain
        // This makes subdivision based on distance from terrain surface, not world origin.
        // Standing on a 500m mountain peak with camera at 502m gives heightAboveTerrain=2,
        // so you get maximum subdivision just like standing on flat ground at height 2.
        const adjustedPosition = this._adjustedPositionForLOD;
        adjustedPosition.set(
          currentPosition.x,
          this.position.y + heightAboveTerrain,
          currentPosition.z
        );

        const closestLeafIndex = this.quadtree.update(
          adjustedPosition,
          useFrustum
        );
        this.lastClosestLeafIndex = closestLeafIndex;

        this.setMetric(
          "updatePosition",
          `${currentPosition.x.toFixed(2)}, ${currentPosition.y.toFixed(2)}, ${currentPosition.z.toFixed(2)}`
        );
        this.setMetric("closestLeafIndex", closestLeafIndex);

        // If recompute is needed or quadtree state changed, mark all stages dirty.
        if (this.shouldRecompute()) {
          this.dag.invalidateAll();
          // Hash/metrics reflect the new quadtree state
          const beforeHash = performance.now();
          this.lastHash = this.quadtree.getStateHash();
          const afterHash = performance.now();
          this.setMetric(
            "hashTime",
            `${(afterHash - beforeHash).toFixed(2)}ms`
          );
          this.setMetric("hash", this.lastHash.toString());
          this.setMetric(
            "leafNodeCount",
            this.quadtree.getLeafNodeCount().toString()
          );
          this.setMetric("nodeCount", this.quadtree.getNodeCount().toString());
          this.setMetric("hasStateChanged", "true");
          this.needsRecompute = false;
        } else {
          this.setMetric("hasStateChanged", "false");
        }

        // Execute dirty DAG stages (may be dirty due to external invalidations like painting).
        if (this.dag.isDirty()) {
          // Ensure GPU-side node buffer and indirection indices reflect current quadtree state.
          this.refreshNodeStorageFromQuadtree();
          const activeLeafData = this.quadtree.getActiveLeafNodeIndices();
          this.count = activeLeafData.count;
          this.lastActiveLeafIndices = activeLeafData.indices;
          this.lastActiveLeafCount = activeLeafData.count;
          this.activeLeafIndicesStorage.update(activeLeafData.indices);

          // NOTE: CPU readback is performed outside update() via readbackTick().
          this.dag.execute(currentRenderer, activeLeafData.count);
        }

        // This is slow
        // // After compute (or if not needed), sample height at the current position
        // const localUV = this.worldToLocalUV(
        //   closestLeafIndex,
        //   currentPosition as unknown as ThreeVector3
        // );
        // // GPU readback path: sample one height value via compute and read it back
        // this.uSampleNodeIndex.value = closestLeafIndex;
        // this.uSampleU.value = localUV.x;
        // this.uSampleV.value = localUV.y;

        // const time = performance.now();
        // await this.lastUpdateHeightComputeShader.renderBind(
        //   currentRenderer,
        //   this.lastUpdateHeightStorage
        // );
        // // Read back single float (little-endian)
        // const heightArrayBuffer: ArrayBuffer = await (
        //   currentRenderer as unknown as {
        //     getArrayBufferAsync: (attr: unknown) => Promise<ArrayBuffer>;
        //   }
        // ).getArrayBufferAsync(
        //   this.lastUpdateHeightStorage.storageBufferAttribute
        // );
        // // Reuse DataView if the underlying buffer identity hasn't changed
        // if (
        //   !this.lastUpdateHeightDataView ||
        //   this.lastUpdateHeightDataView.buffer !== heightArrayBuffer
        // ) {
        //   this.lastUpdateHeightDataView = new DataView(heightArrayBuffer);
        // }
        // const value = this.lastUpdateHeightDataView.getFloat32(0, true);
        // this.lastUpdateHeight = value;
        // // Keep a stable Float32Array for consumers needing a persistent reference
        // if (this.lastUpdateHeightView) {
        //   this.lastUpdateHeightView[0] = value;
        // }
        // const afterReadback = performance.now();
        // this.setMetric(
        //   "lastUpdateHeightComputeTime",
        //   `${afterReadback - time}ms`
        // );
        // this.setMetric("lastUpdateHeight", this.lastUpdateHeight);
        // Loop again if another update was queued while we were computing
      } while (this.hasPendingUpdate);
      const afterUpdate = performance.now();
      this.setMetric("updateTime", `${afterUpdate - beforeUpdate}ms`);
    } finally {
      this.isUpdateInFlight = false;
    }
  }

  private enqueueTile(nodeIndex: number): void {
    if (nodeIndex < 0) return;
    if (this.tileReadbackQueued.has(nodeIndex)) return;
    this.tileReadbackQueued.add(nodeIndex);
    this.tileReadbackQueue.push(nodeIndex);
  }

  /**
   * Request that a tile be read back to the CPU cache in a future `readbackTick()`.
   * This does not perform any GPU->CPU readback by itself.
   */
  prefetchTile(nodeIndex: number): void {
    this.enqueueTile(nodeIndex);
  }

  /**
   * Perform a bounded amount of GPU->CPU readback work, intended to be called from your app loop
   * (e.g. R3F `useFrame`). This keeps `update()` readback-free.
   */
  async readbackTick(
    renderer: WebGPURenderer,
    options: TerrainReadbackTickOptions = {}
  ): Promise<void> {
    if (this.isReadbackInFlight) return;
    this.isReadbackInFlight = true;

    const before = performance.now();
    try {
      const {
        maxTilesPerTick = 1,
        maxCacheTiles = 256,
        includeActiveLeaves = true,
        includeCameraTile = true,
        includeCameraNeighbors = true,
        neighborRadius = 1,
      } = options;

      this.maxCpuTileHeights = maxCacheTiles;

      const nodeView = this.quadtree.getNodeView();

      // Highest priority: camera tile and its neighbors (only among current active leaves).
      const cameraTile =
        includeCameraTile && this.lastClosestLeafIndex != null
          ? this.lastClosestLeafIndex
          : null;
      if (cameraTile != null) {
        this.enqueueTile(cameraTile);

        if (
          includeCameraNeighbors &&
          neighborRadius > 0 &&
          this.lastActiveLeafIndices &&
          this.lastActiveLeafCount > 0
        ) {
          const camLevel = nodeView.getLevel(cameraTile);
          const camX = nodeView.getX(cameraTile);
          const camY = nodeView.getY(cameraTile);

          const neighborKeys = new Set<string>();
          for (let dy = -neighborRadius; dy <= neighborRadius; dy++) {
            for (let dx = -neighborRadius; dx <= neighborRadius; dx++) {
              neighborKeys.add(`${camLevel}:${camX + dx}:${camY + dy}`);
            }
          }

          for (let i = 0; i < this.lastActiveLeafCount; i++) {
            const idx = this.lastActiveLeafIndices[i] ?? 0;
            if (nodeView.getLevel(idx) !== camLevel) continue;
            const k = `${camLevel}:${nodeView.getX(idx)}:${nodeView.getY(idx)}`;
            if (neighborKeys.has(k)) this.enqueueTile(idx);
          }
        }
      }

      // Lower priority: read back active leaves over time.
      if (includeActiveLeaves && this.lastActiveLeafIndices) {
        for (let i = 0; i < this.lastActiveLeafCount; i++) {
          this.enqueueTile(this.lastActiveLeafIndices[i] ?? 0);
        }
      }

      let processed = 0;
      for (; processed < maxTilesPerTick; processed++) {
        const nodeIndex = this.tileReadbackQueue.shift();
        if (nodeIndex == null) break;
        this.tileReadbackQueued.delete(nodeIndex);

        // If it's already cached, refresh LRU and skip the GPU->CPU transfer.
        if (this.cpuTileHeights.has(nodeIndex)) {
          const existing = this.cpuTileHeights.get(nodeIndex);
          if (existing) {
            this.cpuTileHeights.delete(nodeIndex);
            this.cpuTileHeights.set(nodeIndex, existing);
          }
          continue;
        }

        await this.readbackTile(renderer, nodeIndex);
      }

      // Metrics/debug helpers
      this.setMetric("readbackQueueLength", this.tileReadbackQueue.length);
      this.setMetric("cachedTileCount", this.cpuTileHeights.size);
      this.setMetric(
        "readbackTickTime",
        `${(performance.now() - before).toFixed(2)}ms`
      );
      this.setMetric("readbackTilesProcessed", processed);
    } finally {
      this.isReadbackInFlight = false;
    }
  }

  private async readbackTile(
    renderer: WebGPURenderer,
    nodeIndex: number
  ): Promise<void> {
    // Copy tile from heightmapStorage -> tileReadbackStorage via compute.
    this.uTileReadbackNodeIndex.value = nodeIndex;
    await renderer.compute(
      this.tileReadbackComputeNode,
      this.tileReadbackDispatchSize
    );

    // Read back the small tile buffer.
    const tileArrayBuffer: ArrayBuffer = await (
      renderer as unknown as {
        getArrayBufferAsync: (attr: unknown) => Promise<ArrayBuffer>;
      }
    ).getArrayBufferAsync(this.tileReadbackStorage.storageBufferAttribute);

    const incoming = new Float32Array(tileArrayBuffer);
    const existing = this.cpuTileHeights.get(nodeIndex);

    let target: Float32Array;
    if (existing && existing.length === incoming.length) {
      target = existing;
    } else {
      target = new Float32Array(incoming.length);
    }
    target.set(incoming);

    // LRU touch
    if (this.cpuTileHeights.has(nodeIndex))
      this.cpuTileHeights.delete(nodeIndex);
    this.cpuTileHeights.set(nodeIndex, target);

    // Evict oldest entries if needed.
    while (this.cpuTileHeights.size > this.maxCpuTileHeights) {
      const oldestKey = this.cpuTileHeights.keys().next().value as
        | number
        | undefined;
      if (oldestKey == null) break;
      this.cpuTileHeights.delete(oldestKey);
    }

    this.hasValidHeightData = this.cpuTileHeights.size > 0;
  }

  get heightmapNode() {
    return this.heightmapStorage.storageNode;
  }

  get normalMapNode() {
    return this.normalmapStorage.storageNode;
  }

  /**
   * Extract a heightfield grid suitable for physics collision (e.g., Rapier HeightfieldCollider).
   * Samples the terrain at a regular grid of world positions.
   *
   * NOTE: The current implementation uses tile-only CPU caching, so this method is not supported.
   *
   * @param resolution Number of samples along each axis (e.g., 64 creates a 64x64 grid)
   * @param size World-space size of the heightfield (defaults to rootSize)
   * @param centerX World-space X center of the heightfield (defaults to terrain origin)
   * @param centerZ World-space Z center of the heightfield (defaults to terrain origin)
   * @returns Float32Array of heights in row-major order (z * resolution + x), or null if data not ready
   *
   * @example
   * ```ts
   * const heights = terrain.getHeightfieldGrid(64, 200);
   * if (heights) {
   *   <HeightfieldCollider args={[63, 63, heights, { x: 200, y: 1, z: 200 }]} />
   * }
   * ```
   */
  getHeightfieldGrid(
    resolution: number,
    size?: number,
    centerX?: number,
    centerZ?: number
  ): Float32Array | null {
    const fieldSize = size ?? this.params.rootSize;
    const cx = centerX ?? this.position.x;
    const cz = centerZ ?? this.position.z;
    const halfSize = fieldSize / 2;
    const step = fieldSize / (resolution - 1);

    // First pass: determine required tiles and enqueue missing ones.
    // If any required tile isn't cached yet, return null so the caller can retry after readbackTick() runs.
    const requiredTiles = new Set<number>();
    const samplePos = new ThreeVector3();
    let missing = false;

    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const worldX = cx - halfSize + x * step;
        const worldZ = cz - halfSize + z * step;
        samplePos.set(worldX, 0, worldZ);
        const nodeIndex = this.findLeafNodeIndexAt(samplePos);
        if (nodeIndex == null) {
          // Outside terrain coverage
          return null;
        }
        requiredTiles.add(nodeIndex);
      }
    }

    for (const nodeIndex of requiredTiles) {
      if (!this.cpuTileHeights.has(nodeIndex)) {
        this.prefetchTile(nodeIndex);
        missing = true;
      }
    }
    if (missing) return null;

    // Second pass: fill the grid using cached tiles.
    const heights = new Float32Array(resolution * resolution);
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const worldX = cx - halfSize + x * step;
        const worldZ = cz - halfSize + z * step;
        samplePos.set(worldX, 0, worldZ);
        const nodeIndex = this.findLeafNodeIndexAt(samplePos);
        if (nodeIndex == null) return null;

        const uv = this.worldToLocalUV(nodeIndex, samplePos);
        const tile = this.getCachedTileHeights(nodeIndex);
        if (!tile) return null;

        heights[z * resolution + x] = this.sampleHeightFromTile(
          tile,
          uv.x,
          uv.y
        );
      }
    }

    return heights;
  }

  /**
   * Get the raw height data for a specific tile node.
   * Returns the inner heights (excluding skirt vertices) as a Float32Array.
   *
   * @param nodeIndex Index of the node in the quadtree
   * @returns Object with heights array, grid size, and world bounds, or null if invalid
   *
   * @example
   * ```ts
   * const tileData = terrain.getTileHeightData(0);
   * if (tileData) {
   *   console.log(`Tile has ${tileData.gridSize}x${tileData.gridSize} heights`);
   *   console.log(`World bounds: ${tileData.minX}, ${tileData.minZ} to ${tileData.maxX}, ${tileData.maxZ}`);
   * }
   * ```
   */
  getTileHeightData(nodeIndex: number): {
    heights: Float32Array;
    gridSize: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    nodeSize: number;
  } | null {
    const tile = this.getCachedTileHeights(nodeIndex);
    if (!tile) {
      this.prefetchTile(nodeIndex);
      return null;
    }

    const nodeView = this.quadtree.getNodeView();
    const nodeCount = this.quadtree.getNodeCount();
    if (nodeIndex < 0 || nodeIndex >= nodeCount) {
      return null;
    }

    // Check if this is a leaf node (active for rendering)
    if (!nodeView.getLeaf(nodeIndex)) {
      return null;
    }

    const N = this.tileEdgeVertexCount;
    const S = this.params.innerTileSegments;
    const gridSize = S + 1; // Inner grid is S+1 x S+1

    // Extract inner heights (skip skirt vertices at index 0 and N-1)
    const heights = new Float32Array(gridSize * gridSize);

    for (let iy = 0; iy < gridSize; iy++) {
      for (let ix = 0; ix < gridSize; ix++) {
        // Inner vertices start at index 1
        const srcIdx = (iy + 1) * N + (ix + 1);
        const dstIdx = iy * gridSize + ix;
        heights[dstIdx] = tile[srcIdx] ?? 0;
      }
    }

    // Get node properties from NodeView
    const level = nodeView.getLevel(nodeIndex);
    const nodeX = nodeView.getX(nodeIndex);
    const nodeZ = nodeView.getY(nodeIndex); // Y in quadtree is Z in world
    const nodeSize = this.params.rootSize / (1 << level);
    const halfSize = nodeSize / 2;

    return {
      heights,
      gridSize,
      minX: nodeX - halfSize,
      maxX: nodeX + halfSize,
      minZ: nodeZ - halfSize,
      maxZ: nodeZ + halfSize,
      nodeSize,
    };
  }

  /**
   * Get height data for all active leaf nodes.
   * Useful for creating multiple physics colliders for LOD terrain.
   *
   * @returns Array of tile height data for all active leaf nodes, or empty array if data not ready
   */
  getAllLeafHeightData(): Array<{
    nodeIndex: number;
    heights: Float32Array;
    gridSize: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    nodeSize: number;
  }> {
    const result: Array<{
      nodeIndex: number;
      heights: Float32Array;
      gridSize: number;
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      nodeSize: number;
    }> = [];

    // Use active leaves as the source of truth for what can be returned.
    const { indices, count } = this.quadtree.getActiveLeafNodeIndices();
    for (let i = 0; i < count; i++) {
      const nodeIndex = indices[i] ?? 0;
      if (!this.cpuTileHeights.has(nodeIndex)) {
        this.prefetchTile(nodeIndex);
        continue;
      }
      const tileData = this.getTileHeightData(nodeIndex);
      if (tileData) {
        result.push({ nodeIndex, ...tileData });
      }
    }

    return result;
  }

  get tileNode() {
    return this.nodeStorage.storageNode;
  }

  /**
   * Get the position node for this terrain mesh.
   * Use this in your material's positionNode to apply terrain vertex transformations.
   *
   * @example
   * ```ts
   * const terrain = new TerrainMesh({ ... });
   * const material = new MeshStandardNodeMaterial();
   * material.positionNode = terrain.positionNode;
   * terrain.setMaterial(material);
   * ```
   */
  get positionNode() {
    return createWorldPosition(this.uniforms, this.varyings);
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
    const tile = this.getCachedTileHeights(nodeIndex);
    if (!tile) {
      this.prefetchTile(nodeIndex);
      return null;
    }
    return this.sampleHeightFromTile(tile, uv.x, uv.y);
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

  /**
   * Get cached tile heights (N*N, including skirts) and refresh LRU order.
   */
  private getCachedTileHeights(nodeIndex: number): Float32Array | null {
    const tile = this.cpuTileHeights.get(nodeIndex);
    if (!tile) return null;
    // LRU touch
    this.cpuTileHeights.delete(nodeIndex);
    this.cpuTileHeights.set(nodeIndex, tile);
    return tile;
  }

  /**
   * Bilinearly sample a cached tile height array.
   * The cache includes the skirt ring (N = S+3), and UV [0,1] maps to inner indices [1, S+1].
   */
  private sampleHeightFromTile(
    tile: Float32Array,
    u: number,
    v: number
  ): number {
    const N = this.tileEdgeVertexCount; // = innerTileSegments + 3
    const S = this.params.innerTileSegments;

    const x = 1 + u * S;
    const y = 1 + v * S;

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, S + 1);
    const y1 = Math.min(y0 + 1, S + 1);
    const tx = x - x0;
    const ty = y - y0;

    const idx = (ix: number, iy: number) => iy * N + ix;
    const h00 = tile[idx(x0, y0)] ?? 0;
    const h10 = tile[idx(x1, y0)] ?? 0;
    const h01 = tile[idx(x0, y1)] ?? 0;
    const h11 = tile[idx(x1, y1)] ?? 0;

    const rawHeight =
      (1 - tx) * (1 - ty) * h00 +
      tx * (1 - ty) * h10 +
      (1 - tx) * ty * h01 +
      tx * ty * h11;

    const scale = this.uniforms.uHeightmapScale.value as number;
    return rawHeight * scale;
  }

  /**
   * Sample terrain height at a world position using the CURRENT quadtree structure.
   *
   * IMPORTANT: Must be called BEFORE quadtree.update() to use the previous frame's
   * stable structure. The quadtree.update() method calls reset() internally which
   * rebuilds node indices.
   *
   * This method finds the leaf containing the position in the current (pre-reset)
   * quadtree and samples height from the matching cached tile data (when available).
   *
   * @param worldPos World position to sample (only XZ used for lookup, Y ignored)
   * @returns Terrain height at the given position, or lastKnownCameraHeight if unavailable
   */
  private sampleTerrainHeightStable(worldPos: ThreeVector3): number {
    // If we have no cached tiles yet, fall back.
    if (!this.hasValidHeightData) {
      return this.lastKnownCameraHeight;
    }

    // Find which leaf contains this position in the CURRENT (pre-reset) quadtree.
    // This works because we're called BEFORE quadtree.update() which resets everything.
    const leafIndex = this.findLeafNodeIndexAt(worldPos);
    if (leafIndex === null) {
      // Position is outside all leaves (e.g., frustum culled or outside terrain bounds)
      return this.lastKnownCameraHeight;
    }

    // Get local UV within this leaf
    const localUV = this.worldToLocalUV(leafIndex, worldPos);

    const tile = this.getCachedTileHeights(leafIndex);
    if (!tile) {
      this.prefetchTile(leafIndex);
      return this.lastKnownCameraHeight;
    }
    const height = this.sampleHeightFromTile(tile, localUV.x, localUV.y);

    // Update stable fallback for next frame if this fails
    this.lastKnownCameraHeight = height;
    return height;
  }

  destroy() {
    // destroy storage buffers and other resources
    // destroy quadtree
    this.quadtree.destroy();
  }
}
