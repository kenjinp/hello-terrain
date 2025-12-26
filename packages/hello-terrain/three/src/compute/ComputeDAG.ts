import { storage } from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import type { StorageBufferNode } from "three/webgpu";
import type { TerrainUniforms } from "../TerrainUniforms";
import type {
  ComputeStageConfig,
  ComputeStageContext,
  ComputeStageName,
  TypedArrayConstructor,
} from "./ComputeStage";
import { ComputeToBufferMap } from "./ComputeToBufferMap";
import { StorageBuffer, inferWGSLType } from "./StorageBuffer";

export interface ComputeDAGConfig {
  maxNodes: number;
  tileEdgeVertexCount: number;
  uniforms: TerrainUniforms;
  activeLeafIndicesStorage: StorageBuffer;
}

type StageRuntime = {
  config: ComputeStageConfig;
  outputBuffer: StorageBuffer;
  outputNode: StorageBufferNode; // read-write, for the stage to write into
  outputNodeRO: StorageBufferNode;
  shaderActive: ComputeToBufferMap;
  shaderSubset: ComputeToBufferMap;
};

export class ComputeDAG {
  private readonly uniforms: TerrainUniforms;
  private maxNodes: number;
  private tileEdgeVertexCount: number;
  private activeLeafIndicesStorage: StorageBuffer;

  private readonly stages = new Map<ComputeStageName, StageRuntime>();
  private dependents = new Map<ComputeStageName, Set<ComputeStageName>>();

  // Dirty tracking
  private dirtyStages = new Set<ComputeStageName>();
  private dirtyTiles = new Map<ComputeStageName, Set<number>>();

  // Shared indirection buffer used for tile-subset execution
  private subsetIndicesStorage: StorageBuffer;
  private subsetScratch: Uint16Array;

  constructor(config: ComputeDAGConfig) {
    this.maxNodes = config.maxNodes;
    this.tileEdgeVertexCount = config.tileEdgeVertexCount;
    this.uniforms = config.uniforms;
    this.activeLeafIndicesStorage = config.activeLeafIndicesStorage;

    this.subsetScratch = new Uint16Array(this.maxNodes);
    this.subsetIndicesStorage = new StorageBuffer(
      "computeDagSubsetIndices",
      this.subsetScratch,
      1,
      this.maxNodes
    );
  }

  /**
   * Update sizing/config. This recreates all stage output buffers and shaders.
   * Intended for TerrainMesh parameter changes (maxNodes / innerTileSegments).
   */
  reconfigure(
    config: Pick<ComputeDAGConfig, "maxNodes" | "tileEdgeVertexCount">
  ) {
    this.maxNodes = config.maxNodes;
    this.tileEdgeVertexCount = config.tileEdgeVertexCount;

    this.subsetScratch = new Uint16Array(this.maxNodes);
    this.subsetIndicesStorage = new StorageBuffer(
      "computeDagSubsetIndices",
      this.subsetScratch,
      1,
      this.maxNodes
    );

    // Rebuild all stage outputs + shaders
    const existingConfigs = Array.from(this.stages.values()).map(
      (s) => s.config
    );
    this.stages.clear();
    this.dependents.clear();
    this.dirtyStages.clear();
    this.dirtyTiles.clear();
    for (const cfg of existingConfigs) this.addStage(cfg);
    this.invalidateAll();
  }

  setActiveLeafIndicesStorage(storage: StorageBuffer) {
    this.activeLeafIndicesStorage = storage;
    // Rebuild shaders to bind the new indirection buffer
    const existingConfigs = Array.from(this.stages.values()).map(
      (s) => s.config
    );
    this.stages.clear();
    this.dependents.clear();
    for (const cfg of existingConfigs) this.addStage(cfg);
    this.invalidateAll();
  }

  addStage(config: ComputeStageConfig): this {
    if (this.stages.has(config.name)) {
      throw new Error(`ComputeDAG stage already exists: ${config.name}`);
    }
    for (const input of config.inputs) {
      if (!this.stages.has(input)) {
        throw new Error(
          `ComputeDAG stage '${config.name}' depends on missing stage '${input}'`
        );
      }
    }

    const baseItems =
      this.maxNodes * this.tileEdgeVertexCount * this.tileEdgeVertexCount;
    const itemSize = config.output.components;
    const bufferLength = baseItems * itemSize;
    const typed = this.createTypedArray(config.output.type, bufferLength);
    const outputName = config.output.name ?? `${config.name}Storage`;
    const outputBuffer = new StorageBuffer(
      outputName,
      typed,
      itemSize,
      baseItems
    );
    // IMPORTANT:
    // Do NOT call `toReadOnly()` on `outputBuffer.storageNode` directly because some
    // three/tsl implementations mutate the node in-place, which would make the stage
    // output unwritable in compute.
    //
    // Instead, create a distinct read-only node from the same underlying attribute.
    const outputNodeRW = outputBuffer.storageNode;
    const outputNodeRO = storage(
      outputBuffer.storageBufferAttribute,
      inferWGSLType(outputBuffer.buffer),
      outputBuffer.buffer.length
    )
      .setName(`${outputName}_ro`)
      .toReadOnly();

    const shaderActive = this.buildShader(
      config,
      outputBuffer,
      this.activeLeafIndicesStorage
    );
    const shaderSubset = this.buildShader(
      config,
      outputBuffer,
      this.subsetIndicesStorage
    );

    this.stages.set(config.name, {
      config,
      outputBuffer,
      outputNode: outputNodeRW,
      outputNodeRO,
      shaderActive,
      shaderSubset,
    });

    this.rebuildDependents();
    // New stage output is uninitialized; mark it dirty (and its dependents).
    this.invalidate(config.name);
    return this;
  }

  removeStage(name: ComputeStageName): this {
    if (!this.stages.has(name)) return this;
    const deps = this.dependents.get(name);
    if (deps && deps.size > 0) {
      throw new Error(
        `ComputeDAG cannot remove stage '${name}' because dependent stages exist: ${Array.from(deps).join(", ")}`
      );
    }
    // Remove dependents links and the stage itself
    this.stages.delete(name);
    this.dirtyStages.delete(name);
    this.dirtyTiles.delete(name);
    this.rebuildDependents();
    return this;
  }

  hasStage(name: ComputeStageName): boolean {
    return this.stages.has(name);
  }

  getOutput(name: ComputeStageName): StorageBuffer {
    const stage = this.stages.get(name);
    if (!stage) throw new Error(`ComputeDAG missing stage output: ${name}`);
    return stage.outputBuffer;
  }

  getOutputNode(name: ComputeStageName): StorageBufferNode {
    const stage = this.stages.get(name);
    if (!stage) throw new Error(`ComputeDAG missing stage output: ${name}`);
    return stage.outputNodeRO;
  }

  tryGetOutputNode(name: ComputeStageName): StorageBufferNode | null {
    const s = this.stages.get(name);
    return s ? s.outputNodeRO : null;
  }

  invalidate(name: ComputeStageName): void {
    if (!this.stages.has(name)) return;
    this.dirtyStages.add(name);
    // Full-stage invalidation overrides any tile subset.
    this.dirtyTiles.delete(name);
    const deps = this.dependents.get(name);
    if (deps) {
      for (const dep of deps) this.invalidate(dep);
    }
  }

  invalidateTiles(name: ComputeStageName, tiles: number[]): void {
    if (!this.stages.has(name)) return;
    if (tiles.length === 0) return;
    if (this.dirtyStages.has(name)) {
      // Already fully dirty; nothing to do.
      return;
    }
    let set = this.dirtyTiles.get(name);
    if (!set) {
      set = new Set<number>();
      this.dirtyTiles.set(name, set);
    }
    for (const t of tiles) set.add(t);

    // Propagate tile subsets to dependents (same tile indices).
    const deps = this.dependents.get(name);
    if (deps) {
      for (const dep of deps) this.invalidateTiles(dep, tiles);
    }
  }

  invalidateAll(): void {
    for (const name of this.stages.keys()) {
      this.dirtyStages.add(name);
      this.dirtyTiles.delete(name);
    }
  }

  isDirty(): boolean {
    return this.dirtyStages.size > 0 || this.dirtyTiles.size > 0;
  }

  getExecutionOrder(): string[] {
    return this.topoSortAll();
  }

  async execute(
    renderer: WebGPURenderer,
    activeLeafCount: number
  ): Promise<void> {
    if (!this.isDirty()) return;

    const order = this.topoSortAll();
    for (const name of order) {
      const stage = this.stages.get(name);
      if (!stage) continue;

      const isFullDirty = this.dirtyStages.has(name);
      const tileSet = this.dirtyTiles.get(name);
      const hasTileSubset = !isFullDirty && tileSet != null && tileSet.size > 0;

      if (!isFullDirty && !hasTileSubset) continue;

      // Invoke before callback from stage config
      stage.config.onBefore?.();

      if (hasTileSubset) {
        // tileSet is non-null when hasTileSubset is true
        const tiles = Array.from(tileSet as Set<number>);
        this.writeSubsetIndices(tiles);
        stage.shaderSubset.renderBind(
          renderer,
          stage.outputBuffer,
          tiles.length
        );
        this.dirtyTiles.delete(name);
      } else {
        stage.shaderActive.renderBind(
          renderer,
          stage.outputBuffer,
          activeLeafCount
        );
      }

      // Invoke after callback from stage config
      stage.config.onAfter?.();

      this.dirtyStages.delete(name);
    }
  }

  // -------------------------
  // Internals
  // -------------------------

  private rebuildDependents() {
    this.dependents = new Map();
    for (const [name] of this.stages) {
      this.dependents.set(name, new Set());
    }
    for (const [name, stage] of this.stages) {
      for (const input of stage.config.inputs) {
        const deps = this.dependents.get(input);
        if (deps) deps.add(name);
      }
    }
  }

  private topoSortAll(): ComputeStageName[] {
    // Kahn's algorithm over all stages (stable-ish by insertion order)
    const inDeg = new Map<ComputeStageName, number>();
    for (const [name] of this.stages) inDeg.set(name, 0);
    for (const [name, s] of this.stages) {
      for (const input of s.config.inputs) {
        if (!this.stages.has(input)) {
          throw new Error(
            `ComputeDAG invalid graph: stage '${name}' missing input '${input}'`
          );
        }
        inDeg.set(name, (inDeg.get(name) ?? 0) + 1);
      }
    }

    const q: ComputeStageName[] = [];
    for (const [name, deg] of inDeg) if (deg === 0) q.push(name);

    const out: ComputeStageName[] = [];
    while (q.length) {
      const n = q.shift();
      if (n == null) break;
      out.push(n);
      const deps = this.dependents.get(n);
      if (!deps) continue;
      for (const d of deps) {
        const next = (inDeg.get(d) ?? 0) - 1;
        inDeg.set(d, next);
        if (next === 0) q.push(d);
      }
    }

    if (out.length !== this.stages.size) {
      throw new Error("ComputeDAG cycle detected");
    }
    return out;
  }

  private buildShader(
    config: ComputeStageConfig,
    output: StorageBuffer,
    indirection: StorageBuffer
  ): ComputeToBufferMap {
    const shader = new ComputeToBufferMap(
      (nodeIndex, globalVertexIndex, localUV, _localCoordinates, texelSize) => {
        const ctx: ComputeStageContext = {
          nodeIndex,
          globalVertexIndex,
          localUV,
          texelSize,
          uniforms: this.uniforms,
          input: (stageName: ComputeStageName) => {
            const s = this.stages.get(stageName);
            if (!s)
              throw new Error(`ComputeDAG missing input stage: ${stageName}`);
            return s.outputNodeRO;
          },
          // Write to the stage's RW node (never the RO view).
          output: output.storageNode,
        };
        config.compute(ctx);
      }
    );

    shader.createBinds(
      this.tileEdgeVertexCount,
      config.output.components,
      this.maxNodes,
      indirection,
      output
    );
    return shader;
  }

  private writeSubsetIndices(tiles: number[]) {
    // Fill first N with tile indices; fill the rest with 0 to keep padded dispatch safe.
    this.subsetScratch.fill(0);
    const n = Math.min(tiles.length, this.subsetScratch.length);
    for (let i = 0; i < n; i++) {
      const t = tiles[i] ?? 0;
      this.subsetScratch[i] = t < 0 ? 0 : (t as number);
    }
    this.subsetIndicesStorage.update();
  }

  private createTypedArray(ctor: TypedArrayConstructor, length: number) {
    // eslint-disable-next-line new-cap
    return new ctor(length);
  }
}
