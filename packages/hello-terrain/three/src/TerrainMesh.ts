import type { Ray as ThreeRay } from "three";
import { Vector2 as ThreeVector2, Vector3 as ThreeVector3 } from "three";
import { float, int, max, min, pow, select, uniform, vec3 } from "three/tsl";
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
import { ComputeToBufferMap } from "./compute/ComputeToBufferMap";
import { ControlDataPacker } from "./compute/ControlStorage";
import { StorageBuffer } from "./compute/StorageBuffer";
import { TerrainGeometry } from "./geometry/TerrainGeometry";
import type { ControlReturn } from "./nodes/ControlFn";
import { ElevationFn, type ElevationReturn } from "./nodes/ElevationFn";
import { createControl } from "./nodes/control";
import { createHeight } from "./nodes/height";
import { createWorldPosition } from "./nodes/position";
import {
  activeLeafIndicesStorageProperty,
  controlmapStorageProperty,
  heightmapStorageProperty,
  nodeStorageProperty,
  normalmapStorageProperty,
} from "./nodes/properties";
import { createTileIsLeaf, createTileLevel } from "./nodes/tile";
import {
  Quadtree,
  type QuadtreeParams,
  type SubdivisionStrategy,
  distanceBasedSubdivision,
} from "./quadtree/Quadtree";
import type { TerrainTextureArray } from "./texture/TerrainTextureArray";

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
   * Indicates whether valid heightmap data is available for CPU queries.
   * This becomes true after the first successful GPU readback completes.
   * Use this to check if queryHeightAtPosition will return meaningful values.
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
  // @ts-ignore will be initialized
  private heightmapComputeShader: ComputeToBufferMap;
  // @ts-ignore will be initialized
  private normalmapComputeShader: ComputeToBufferMap;
  // @ts-ignore will be initialized
  private controlmapComputeShader: ComputeToBufferMap;
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
  // Local compute uniform to avoid relying on shared global uniforms in compute pipelines
  // @ts-ignore will be initialized
  private uComputeRootSize: ReturnType<typeof uniform>;
  // @ts-ignore will be initialized
  private uComputeHeightmapScale: ReturnType<typeof uniform>;
  // Cached views to avoid per-frame allocations on readback
  private lastUpdateHeightView: Float32Array | null = null;
  // @ts-ignore
  private lastUpdateHeightDataView: DataView | null = null;
  // CPU-side heightmap cache for fast terrain height lookups (previous frame data)
  private cpuHeightmapCache: Float32Array | null = null;
  private lastKnownCameraHeight = 0;
  private lastUpdatePosition: ThreeVector3 | null = null;
  public readonly params: TerrainMeshParams;
  public textureArray?: TerrainTextureArray;
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
    this.params = merged;
    this.params.epsilon =
      params.epsilon ?? this.params.minNodeSize / this.params.innerTileSegments;
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
    this.initializeComputeShaders();
    this.initializeReadbackCompute();
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

    // Create storage buffer for active leaf indices (used for indirection in optimized compute)
    const activeLeafIndicesStorage = new StorageBuffer(
      "activeLeafIndicesStorage",
      new Uint16Array(maxNodes),
      1,
      maxNodes
    );
    this.activeLeafIndicesStorage = activeLeafIndicesStorage;

    normalmapStorageProperty.value = normalmapStorage.storageBufferAttribute;
    activeLeafIndicesStorageProperty.value =
      activeLeafIndicesStorage.storageBufferAttribute;

    // Initialize control map storage with default texture
    const defaultPacked = ControlDataPacker.pack({
      baseTextureId: this.params.defaultTextureId ?? 0,
      overlayTextureId: 0,
      blend: 0,
    });
    const controlmapStorage = new StorageBuffer(
      "controlmapStorage",
      new Uint32Array(heightmapDimensions).fill(defaultPacked),
      1,
      heightmapDimensions
    );
    this.controlmapStorage = controlmapStorage;
    controlmapStorageProperty.value = controlmapStorage.storageBufferAttribute;

    return { nodeStorage, heightmapStorage, normalmapStorage };
  }

  private initializeComputeShaders(): ComputeToBufferMap {
    // Ensure uniforms reflect current params before building compute nodes
    this.applyUniforms();
    // Create local compute uniform for root size (decoupled from shared global uniforms)
    // Sanitize UUID for WGSL compliance (replace hyphens with underscores)
    const sanitizedUuid = this.uuid.replace(/-/g, "_");
    this.uComputeRootSize = uniform(this.params.rootSize).setName(
      `uComputeRootSize_${sanitizedUuid}`
    );
    this.uComputeHeightmapScale = uniform(
      this.uniforms.uHeightmapScale.value as number
    ).setName(`uComputeHeightmapScale_${sanitizedUuid}`);
    const tileEdgeVertexCount = this.params.innerTileSegments + 1 + 2;
    const heightFn = createHeight(
      this.uniforms,
      this.params.elevationFn ?? ElevationFn(() => float(0))
    );
    const heightShader = new ComputeToBufferMap(
      (
        nodeIndex,
        globalVertexIndex,
        localUV,
        _localCoordinates,
        _texelSize
      ) => {
        const h = heightFn(nodeIndex, localUV, _texelSize);
        this.heightmapStorage.storageNode.element(globalVertexIndex).assign(h);
      }
    );
    heightShader.createBinds(
      tileEdgeVertexCount,
      1,
      this.quadtree.getConfig().maxNodes,
      this.heightmapStorage
    );
    // Create optimized binds for compute with indirection
    heightShader.createBinds(
      tileEdgeVertexCount,
      1,
      this.quadtree.getConfig().maxNodes,
      this.activeLeafIndicesStorage,
      this.heightmapStorage
    );
    this.heightmapComputeShader = heightShader;

    // Normalmap compute shader (finite differences on heightmap)
    const tileIsLeaf = createTileIsLeaf();
    const tileLevel = createTileLevel();

    const normalShader = new ComputeToBufferMap(
      (
        nodeIndex,
        globalVertexIndex,
        localUV,
        _localCoordinates,
        _texelSize
      ) => {
        const edgeVertexCount = int(tileEdgeVertexCount);
        const lastVertexIndex = edgeVertexCount.sub(int(1));

        const uVertexIndex = localUV.x
          .mul(edgeVertexCount.toFloat())
          .floor()
          .toInt();
        const vVertexIndex = localUV.y
          .mul(edgeVertexCount.toFloat())
          .floor()
          .toInt();

        // Neighbor indices including skirt ring for central differences at inner edges
        const uLeft = max(uVertexIndex.sub(int(1)), int(0));
        const uRight = min(uVertexIndex.add(int(1)), lastVertexIndex);
        const vDown = max(vVertexIndex.sub(int(1)), int(0));
        const vUp = min(vVertexIndex.add(int(1)), lastVertexIndex);

        const numVerticesPerNode = edgeVertexCount.mul(edgeVertexCount);
        const nodeVertexBaseIndex = int(nodeIndex).mul(numVerticesPerNode);
        // Read raw heights (0-1 range) and scale by heightmap scale to get world-space heights
        const heightScale = this.uComputeHeightmapScale.toVar();
        const hC = this.heightmapStorage.storageNode
          .element(
            nodeVertexBaseIndex.add(
              vVertexIndex.mul(edgeVertexCount).add(uVertexIndex)
            )
          )
          .mul(heightScale);
        const hLm = this.heightmapStorage.storageNode
          .element(
            nodeVertexBaseIndex.add(
              vVertexIndex.mul(edgeVertexCount).add(uLeft)
            )
          )
          .mul(heightScale);
        const hRp = this.heightmapStorage.storageNode
          .element(
            nodeVertexBaseIndex.add(
              vVertexIndex.mul(edgeVertexCount).add(uRight)
            )
          )
          .mul(heightScale);
        const hDm = this.heightmapStorage.storageNode
          .element(
            nodeVertexBaseIndex.add(
              vDown.mul(edgeVertexCount).add(uVertexIndex)
            )
          )
          .mul(heightScale);
        const hUp = this.heightmapStorage.storageNode
          .element(
            nodeVertexBaseIndex.add(vUp.mul(edgeVertexCount).add(uVertexIndex))
          )
          .mul(heightScale);

        const isNodeActive = nodeStorageProperty
          .element(nodeIndex.mul(4).add(3))
          .equal(int(1));
        const isNodeLeaf = tileIsLeaf(nodeIndex);

        // Compute world-space texel size for inner grid (S = edge - 3)
        const nodeLevel = tileLevel(nodeIndex);
        const tileSizeWorld = this.uComputeRootSize
          .toVar()
          .div(pow(float(2), nodeLevel.toFloat()));
        const innerSegments = float(tileEdgeVertexCount).sub(float(3));
        const stepWorld = tileSizeWorld.div(innerSegments);
        const invStep = float(1).div(stepWorld);
        const inv2Step = float(0.5).div(stepWorld);

        // Extremes are actual skirt vertices (index 0 or last)
        const atLeftExtreme = uVertexIndex.equal(int(0));
        const atRightExtreme = uVertexIndex.equal(lastVertexIndex);
        const atBottomExtreme = vVertexIndex.equal(int(0));
        const atTopExtreme = vVertexIndex.equal(lastVertexIndex);

        // One-sided at skirt ring, central elsewhere (inner edges use skirt as neighbor)
        const dX = select(
          atLeftExtreme,
          hRp.sub(hC).mul(invStep),
          select(
            atRightExtreme,
            hC.sub(hLm).mul(invStep),
            hRp.sub(hLm).mul(inv2Step)
          )
        );
        const dZ = select(
          atBottomExtreme,
          hUp.sub(hC).mul(invStep),
          select(
            atTopExtreme,
            hC.sub(hDm).mul(invStep),
            hUp.sub(hDm).mul(inv2Step)
          )
        );

        const computedNormal = vec3(
          dX.negate(),
          float(1),
          dZ.negate()
        ).normalize();
        const finalNormal = select(
          isNodeActive.and(isNodeLeaf),
          computedNormal,
          vec3(0, 0, 0)
        );

        const normalOutputBaseIndex = int(globalVertexIndex).mul(int(3));
        this.normalmapStorage.storageNode
          .element(normalOutputBaseIndex.add(int(0)))
          .assign(finalNormal.x);
        this.normalmapStorage.storageNode
          .element(normalOutputBaseIndex.add(int(1)))
          .assign(finalNormal.y);
        this.normalmapStorage.storageNode
          .element(normalOutputBaseIndex.add(int(2)))
          .assign(finalNormal.z);
      }
    );
    normalShader.createBinds(
      tileEdgeVertexCount,
      3,
      this.quadtree.getConfig().maxNodes,
      this.normalmapStorage
    );
    // Create optimized binds for compute with indirection
    normalShader.createBinds(
      tileEdgeVertexCount,
      3,
      this.quadtree.getConfig().maxNodes,
      this.activeLeafIndicesStorage,
      this.normalmapStorage
    );
    this.normalmapComputeShader = normalShader;

    // Control map compute shader (runs after height and normal to access their data)
    // Only create if a controlFn is provided
    if (this.params.controlFn) {
      const controlFn = createControl(
        this.uniforms,
        this.params.controlFn,
        this.heightmapStorage,
        this.normalmapStorage,
        tileEdgeVertexCount
      );
      const controlShader = new ComputeToBufferMap(
        (
          nodeIndex,
          globalVertexIndex,
          localUV,
          _localCoordinates,
          _texelSize
        ) => {
          const controlData = controlFn(
            nodeIndex,
            globalVertexIndex,
            localUV,
            _texelSize
          );
          this.controlmapStorage.storageNode
            .element(globalVertexIndex)
            .assign(controlData);
        }
      );
      controlShader.createBinds(
        tileEdgeVertexCount,
        1,
        this.quadtree.getConfig().maxNodes,
        this.controlmapStorage
      );
      // Create optimized binds for compute with indirection
      controlShader.createBinds(
        tileEdgeVertexCount,
        1,
        this.quadtree.getConfig().maxNodes,
        this.activeLeafIndicesStorage,
        this.controlmapStorage
      );
      this.controlmapComputeShader = controlShader;
    }

    return heightShader;
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

  private async runNormalMapCompute(renderer: WebGPURenderer): Promise<void> {
    const beforeCompute = performance.now();

    // Get active leaf count for optimized compute dispatch
    const activeLeafData = this.quadtree.getActiveLeafNodeIndices();
    const activeLeafCount = activeLeafData.count;

    // Update the active leaf indices buffer (already updated in runHeightmapCompute, but doing it again for safety)
    this.activeLeafIndicesStorage.update(activeLeafData.indices);

    await this.normalmapComputeShader.renderBindOptimized(
      renderer,
      this.normalmapStorage,
      activeLeafCount
    );

    const afterCompute = performance.now();
    this.setMetric("normalmapComputeTime", `${afterCompute - beforeCompute}ms`);
  }

  private async runControlMapCompute(renderer: WebGPURenderer): Promise<void> {
    // Only run if a controlFn is provided
    if (!this.controlmapComputeShader) return;

    const beforeCompute = performance.now();

    // Get active leaf count for optimized compute dispatch
    const activeLeafData = this.quadtree.getActiveLeafNodeIndices();
    const activeLeafCount = activeLeafData.count;

    // Update the active leaf indices buffer
    this.activeLeafIndicesStorage.update(activeLeafData.indices);

    await this.controlmapComputeShader.renderBindOptimized(
      renderer,
      this.controlmapStorage,
      activeLeafCount
    );

    const afterCompute = performance.now();
    this.setMetric(
      "controlmapComputeTime",
      `${afterCompute - beforeCompute}ms`
    );
  }

  private applyUniforms(): void {
    this.uniforms.update(
      this.position,
      this.params.rootSize,
      this.params.innerTileSegments
    );
    // Keep compute-local uniforms in sync if initialized
    if (this.uComputeRootSize) {
      this.uComputeRootSize.value = this.params.rootSize;
    }
    if (this.uComputeHeightmapScale) {
      this.uComputeHeightmapScale.value = this.uniforms.uHeightmapScale
        .value as number;
    }
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

  private async runHeightmapCompute(renderer: WebGPURenderer): Promise<void> {
    const beforeCompute = performance.now();
    this.refreshNodeStorageFromQuadtree();

    // Get active leaf data for optimized compute dispatch
    const activeLeafData = this.quadtree.getActiveLeafNodeIndices();
    const activeLeafCount = activeLeafData.count;

    // Update the GPU-side active leaf indices so compute shader can use indirection
    const nodeViewBuffers = this.quadtree.getNodeView().getBuffers();
    this.nodeStorage.update(nodeViewBuffers.nodeBuffer);

    // Update the active leaf indices buffer for GPU indirection
    this.activeLeafIndicesStorage.update(activeLeafData.indices);

    // Render compute using only active leaf nodes
    await this.heightmapComputeShader.renderBindOptimized(
      renderer,
      this.heightmapStorage,
      activeLeafCount
    );

    // Read back heightmap from GPU to CPU for height queries
    // This enables queryHeightAtPosition to return actual terrain heights
    try {
      const heightArrayBuffer: ArrayBuffer = await (
        renderer as unknown as {
          getArrayBufferAsync: (attr: unknown) => Promise<ArrayBuffer>;
        }
      ).getArrayBufferAsync(this.heightmapStorage.storageBufferAttribute);

      const heightmapArray = new Float32Array(heightArrayBuffer);
      if (!this.cpuHeightmapCache) {
        this.cpuHeightmapCache = new Float32Array(heightmapArray.length);
      }
      this.cpuHeightmapCache.set(heightmapArray);

      // Also update the storageBufferAttribute array for sampleHeightFromBuffer
      const storageArray = this.heightmapStorage.storageBufferAttribute
        .array as Float32Array;
      storageArray.set(heightmapArray);

      // Mark that valid height data is now available for queries
      this.hasValidHeightData = true;
    } catch {
      // Fallback: use existing CPU array (may be stale/zeros on first frames)
      const heightmapArray = this.heightmapStorage.storageBufferAttribute
        .array as Float32Array;
      if (!this.cpuHeightmapCache) {
        this.cpuHeightmapCache = new Float32Array(heightmapArray.length);
      }
      this.cpuHeightmapCache.set(heightmapArray);
    }

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
    this.setMetric("activeLeafCount", activeLeafCount.toString());
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
    // Re-apply uniforms and fully refresh GPU bindings to avoid stale layouts/bind groups
    this.applyUniforms();
    // Recreate storages so storage properties (used by both compute and render) are definitely in sync
    const storages = this.initializeStorage();
    this.nodeStorage = storages.nodeStorage;
    this.heightmapStorage = storages.heightmapStorage;
    this.normalmapStorage = storages.normalmapStorage;
    // Rebuild compute shaders that write into the refreshed storages
    this.heightmapComputeShader = this.initializeComputeShaders();
    // Recreate readback compute to match any layout changes
    this.initializeReadbackCompute();
    this.needsRecompute = true;
  }

  get elevationFn() {
    return this.params.elevationFn ?? ElevationFn(() => float(0));
  }

  set controlFn(fn: ControlReturn | undefined) {
    this.params.controlFn = fn;
    // Re-apply uniforms and fully refresh GPU bindings
    this.applyUniforms();
    // Recreate storages so storage properties are in sync
    const storages = this.initializeStorage();
    this.nodeStorage = storages.nodeStorage;
    this.heightmapStorage = storages.heightmapStorage;
    this.normalmapStorage = storages.normalmapStorage;
    // Rebuild compute shaders that write into the refreshed storages
    this.heightmapComputeShader = this.initializeComputeShaders();
    // Recreate readback compute to match any layout changes
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

  update(renderer: WebGPURenderer, position: Vector3, frustum: Frustum) {
    // Check if position change is below epsilon threshold - skip update if so
    const epsilon = this.params.epsilon ?? 0.0;
    if (epsilon > 0 && this.lastUpdatePosition) {
      // Use Three.js Vector3 method .distanceToSquared
      if (
        position.distanceToSquared(this.lastUpdatePosition) <
        epsilon * epsilon
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
        // Do initial quadtree update to get closest leaf node using current position
        let closestLeafIndex = this.quadtree.update(
          currentPosition,
          useFrustum
        );

        // Look up terrain height at this position using cached data from previous frame
        // This is extremely fast (<0.1ms) and allows quadtree to subdivide relative to terrain surface
        const terrainHeight = this.getTerrainHeightAt(
          currentPosition as unknown as ThreeVector3,
          closestLeafIndex
        );

        // Create adjusted position with terrain height instead of raw camera Y
        // This ensures quadtree subdivides based on distance to terrain surface, not origin
        this.pendingPosition.y -= terrainHeight;
        // Do final quadtree update with terrain-adjusted position
        closestLeafIndex = this.quadtree.update(
          this.pendingPosition,
          useFrustum
        );

        this.setMetric(
          "updatePosition",
          `${currentPosition.x.toFixed(2)}, ${terrainHeight.toFixed(2)}, ${currentPosition.z.toFixed(2)}`
        );
        this.setMetric("closestLeafIndex", closestLeafIndex);

        // If recompute is needed or quadtree state changed, run the compute pass
        if (this.shouldRecompute()) {
          // Ensure the GPU-side node buffer reflects the latest quadtree state
          this.refreshNodeStorageFromQuadtree();
          // Compute heightmap first so the normal pass samples fresh height data
          // Note: We don't await here - the GPU compute runs asynchronously
          // The CPU readback populates the cache for queryHeightAtPosition
          this.runHeightmapCompute(currentRenderer);
          this.runNormalMapCompute(currentRenderer);
          // Control map runs after height and normal to access their computed data
          this.runControlMapCompute(currentRenderer);

          // Update instance count to only render active leaf nodes
          const activeLeafData = this.quadtree.getActiveLeafNodeIndices();
          this.count = activeLeafData.count;
          // Update the active leaf indices buffer for vertex shader indirection
          this.activeLeafIndicesStorage.update(activeLeafData.indices);
        } else {
          this.setMetric("hasStateChanged", "false");
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

  get heightmapNode() {
    return this.heightmapStorage.storageNode;
  }

  get normalMapNode() {
    return this.normalmapStorage.storageNode;
  }

  /**
   * Extract a heightfield grid suitable for physics collision (e.g., Rapier HeightfieldCollider).
   * Samples the terrain at a regular grid of world positions using the CPU heightmap cache.
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
    if (!this.hasValidHeightData || !this.cpuHeightmapCache) {
      return null;
    }

    const fieldSize = size ?? this.params.rootSize;
    const cx = centerX ?? this.position.x;
    const cz = centerZ ?? this.position.z;
    const halfSize = fieldSize / 2;
    const step = fieldSize / (resolution - 1);

    const heights = new Float32Array(resolution * resolution);
    const samplePos = new ThreeVector3();

    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const worldX = cx - halfSize + x * step;
        const worldZ = cz - halfSize + z * step;
        samplePos.set(worldX, 0, worldZ);

        const height = this.queryHeightAtPosition(samplePos);
        // Row-major order for Rapier
        heights[z * resolution + x] = height ?? 0;
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
    if (!this.cpuHeightmapCache) {
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
    const perNode = N * N;
    const base = nodeIndex * perNode;

    for (let iy = 0; iy < gridSize; iy++) {
      for (let ix = 0; ix < gridSize; ix++) {
        // Inner vertices start at index 1
        const srcIdx = base + (iy + 1) * N + (ix + 1);
        const dstIdx = iy * gridSize + ix;
        heights[dstIdx] = this.cpuHeightmapCache[srcIdx] ?? 0;
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
    if (!this.hasValidHeightData || !this.cpuHeightmapCache) {
      return [];
    }

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

    // Use getActiveLeafNodeIndices for efficient iteration over only active leaves
    const { indices, count } = this.quadtree.getActiveLeafNodeIndices();

    for (let i = 0; i < count; i++) {
      const nodeIndex = indices[i];
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

  /**
   * Bilinearly sample the heightmap buffer for a node at local UV.
   *
   * The heightmap is stored with tileEdgeVertexCount (S+3) vertices per axis:
   * - Index 0: skirt vertex (outside tile, left/bottom edge)
   * - Indices 1 to S+1: inner vertices (logical tile, S+1 = innerTileSegments+1 vertices)
   * - Index S+2: skirt vertex (outside tile, right/top edge)
   *
   * UV [0,1] from worldToLocalUV represents the logical tile bounds,
   * which corresponds to inner vertex indices [1, S+1].
   *
   * NOTE: This method applies uniforms.uHeightmapScale to match the vertex shader
   * behavior in position.ts, which also multiplies stored heights by this scale.
   *
   * @param nodeIndex Index of the node to sample from
   * @param u Local U coordinate [0,1] within the tile
   * @param v Local V coordinate [0,1] within the tile
   * @returns Interpolated height at the given UV position (scaled by uHeightmapScale)
   */
  private sampleHeightFromBuffer(
    nodeIndex: number,
    u: number,
    v: number
  ): number {
    const N = this.tileEdgeVertexCount; // = innerTileSegments + 3
    const S = this.params.innerTileSegments;

    // Map UV [0,1] to inner vertex indices [1, S+1]
    // UV=0 → index 1 (first inner vertex)
    // UV=1 → index S+1 (last inner vertex)
    const x = 1 + u * S;
    const y = 1 + v * S;

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, S + 1); // Clamp to last inner vertex
    const y1 = Math.min(y0 + 1, S + 1);
    const tx = x - x0;
    const ty = y - y0;

    const perNode = N * N;
    const base = nodeIndex * perNode;
    const idx = (ix: number, iy: number) => base + iy * N + ix;

    const arr = this.heightmapStorage.storageBufferAttribute
      .array as Float32Array;
    const h00 = arr[idx(x0, y0)] ?? 0;
    const h10 = arr[idx(x1, y0)] ?? 0;
    const h01 = arr[idx(x0, y1)] ?? 0;
    const h11 = arr[idx(x1, y1)] ?? 0;

    const rawHeight =
      (1 - tx) * (1 - ty) * h00 +
      tx * (1 - ty) * h10 +
      (1 - tx) * ty * h01 +
      tx * ty * h11;

    // Apply the same heightmapScale that the vertex shader uses
    // This ensures CPU height queries match the rendered terrain
    const scale = this.uniforms.uHeightmapScale.value as number;
    return rawHeight * scale;
  }

  /**
   * Fast terrain height lookup at world position using cached heightmap from previous frame.
   * This has ~1 frame latency but is extremely fast (<0.1ms) for use in quadtree subdivision.
   * Falls back to lastKnownCameraHeight if cache isn't available yet.
   *
   * NOTE: The height is scaled by uniforms.uHeightmapScale to match the rendered terrain.
   *
   * @param worldPos World XZ position to sample
   * @param closestLeafIndex Index of closest leaf node (from quadtree.update)
   * @returns Terrain height at the given position, or last known height if cache unavailable
   */
  private getTerrainHeightAt(
    worldPos: ThreeVector3,
    closestLeafIndex: number
  ): number {
    // If no cache yet or invalid leaf index, return last known height (first frame uses 0)
    if (!this.cpuHeightmapCache || closestLeafIndex === -1) {
      return this.lastKnownCameraHeight;
    }

    // Convert world position to local UV within the closest node
    const localUV = this.worldToLocalUV(closestLeafIndex, worldPos);

    // Sample from CPU cache using bilinear interpolation
    // Map UV [0,1] to inner vertex indices [1, S+1]
    const N = this.tileEdgeVertexCount;
    const S = this.params.innerTileSegments;

    const u = localUV.x;
    const v = localUV.y;
    const x = 1 + u * S;
    const y = 1 + v * S;

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, S + 1);
    const y1 = Math.min(y0 + 1, S + 1);
    const tx = x - x0;
    const ty = y - y0;

    const perNode = N * N;
    const base = closestLeafIndex * perNode;
    const idx = (ix: number, iy: number) => base + iy * N + ix;

    const h00 = this.cpuHeightmapCache[idx(x0, y0)] || 0;
    const h10 = this.cpuHeightmapCache[idx(x1, y0)] || 0;
    const h01 = this.cpuHeightmapCache[idx(x0, y1)] || 0;
    const h11 = this.cpuHeightmapCache[idx(x1, y1)] || 0;

    const rawHeight =
      (1 - tx) * (1 - ty) * h00 +
      tx * (1 - ty) * h10 +
      (1 - tx) * ty * h01 +
      tx * ty * h11;

    // Apply the same heightmapScale that the vertex shader uses
    // This ensures CPU height queries match the rendered terrain
    const scale = this.uniforms.uHeightmapScale.value as number;
    const height = rawHeight * scale;

    // Store for next frame if cache fails
    this.lastKnownCameraHeight = height;
    return height;
  }

  destroy() {
    // destroy storage buffers and other resources
    // destroy quadtree
    this.quadtree.destroy();
  }
}
