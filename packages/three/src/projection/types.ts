import type { Ray, Vector3 } from "three";
import type { Node } from "three/webgpu";
import type {
  LeafTileNodes,
  TileCompute,
  TileComputeParts,
  TileComputePartsContext,
} from "../gpu/tile";
import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
import type { CpuTerrainCache } from "../query/cpu-terrain-cache";
import type { ElevationGridShape } from "../query/elevation-field-sampling";
import type {
  CreateTerrainSamplerParams,
  RaycastOptions,
  TerrainQuery,
  TerrainRaycastConfig,
  TerrainRaycastResult,
  TerrainSampler,
  TerrainSphereQuery,
  TerrainSurfaceQuery,
} from "../query/types";
import type { LeafStorageState, TerrainUniformsContext } from "../types";

/** Stable projection identifier — for debugging/telemetry only, never switched on. */
export type ProjectionKind = "flat" | "cubeSphere" | "torus" | (string & {});

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

// ── GPU (TSL) ────────────────────────────────────────────────────────────

export interface RenderVertexPositionContext {
  leafStorage: LeafStorageState;
  uniforms: TerrainUniformsContext;
  terrainFieldStorage?: TerrainFieldStorage;
}

export interface FieldNormalContext {
  elevationFieldNode: Node;
  edgeVertexCount: number;
  tile: TileCompute;
  uniforms: TerrainUniformsContext;
}

/** Per-vertex field-stage normal: `(nodeIndex, ix, iy) => unit world normal`. */
export type FieldNormalFn = (nodeIndex: Node, ix: Node, iy: Node) => Node;

export interface SurfaceProjectionGpu {
  /** Render-path world position; also assigns the vertex normal varying. */
  renderVertexPosition(ctx: RenderVertexPositionContext): Node;
  /** Projection-specific compute-stage tile builders (size / uv / position). */
  createTileComputeParts(ctx: TileComputePartsContext): TileComputeParts;
  /** Field-stage surface normal builder. */
  createFieldNormal(ctx: FieldNormalContext): FieldNormalFn;
  /** Optional extra GPU samplers (e.g. sphere ByDirection); no-op for flat. */
  augmentSampler?(sampler: TerrainSampler, params: CreateTerrainSamplerParams): void;
}

// ── CPU surface sampling (injected into the terrain cache) ─────────────────

/** A world point projected onto a closed surface: tile space + face-local uv. */
export interface SurfaceKey {
  /** Tile space/face index (0 for torus, 0..5 for cube-sphere faces). */
  space: number;
  /** Face-local u in [0, 1). */
  u: number;
  /** Face-local v in [0, 1). */
  v: number;
  /** Outward unit direction at the key (for the surface sample `direction`). */
  dirX: number;
  dirY: number;
  dirZ: number;
}

/** Grid neighborhood passed to {@link CpuSurfaceOps.surfaceNormal}. */
export interface SurfaceNormalContext {
  elevation: Float32Array;
  shape: ElevationGridShape;
  leafIndex: number;
  /** Fractional grid coords of the sample within the leaf. */
  gx: number;
  gy: number;
  innerTileSegments: number;
  elevationScale: number;
  level: number;
}

/**
 * Projection-specific CPU surface math, injected into the terrain cache so the
 * cache stays projection-agnostic. Implementations own their scratch (no
 * module-scope state).
 */
export interface CpuSurfaceOps {
  /** Map a world position to a surface key; `false` if it has no projection. */
  positionToKey(px: number, py: number, pz: number, out: SurfaceKey): boolean;
  /** Displaced world position from a key + scaled elevation (writes `out`). */
  surfacePosition(key: SurfaceKey, elevation: number, out: Vector3): void;
  /** Unit world-space surface normal from a key + grid neighborhood. */
  surfaceNormal(key: SurfaceKey, ctx: SurfaceNormalContext): Vector3;
}

// ── CPU (query / raycast / LOD) ────────────────────────────────────────────

export interface ProjectionRaycastContext {
  ray: Ray;
  options?: RaycastOptions;
  terrainQuery: TerrainQuery | null;
  surfaceQuery: TerrainSurfaceQuery | null;
  sphereQuery: TerrainSphereQuery | null;
  config: TerrainRaycastConfig;
}

export interface RuntimeQueries {
  query: TerrainQuery;
  /** Generic surface query (position/uv keyed); `null` on flat surfaces. */
  surfaceQuery: TerrainSurfaceQuery | null;
  /** Cube-sphere query (adds direction/lat-long); `null` unless cube-sphere. */
  sphereQuery: TerrainSphereQuery | null;
}

export interface SurfaceProjectionCpu {
  /**
   * Surface sampling ops injected into the terrain cache; `null` for flat
   * surfaces (which have no closed-surface query).
   */
  createSurfaceOps(): CpuSurfaceOps | null;
  /** Build the runtime query objects the projection exposes. */
  createRuntimeQueries(cache: CpuTerrainCache): RuntimeQueries;
  /**
   * Projection-specific CPU raycast against the displaced surface. Returns
   * `null` when the ray misses the surface or the query snapshot isn't ready.
   */
  raycast(ctx: ProjectionRaycastContext): TerrainRaycastResult | null;
}

// ── The injected strategy ──────────────────────────────────────────────────

export interface SurfaceProjection {
  /** Identifier; never switched on internally. */
  readonly kind: ProjectionKind;
  /** Representative radius (bounds/uniform helper); undefined for flat. */
  readonly radius?: number;
  /** Surface center in world space; undefined for flat. */
  readonly center?: Vec3Like;
  /** Closed surfaces face outward → flip triangle winding. */
  readonly faceOutward: boolean;
  /**
   * Per-axis level-0 tile count before LOD subdivision. Defaults to `{ u: 1, v: 1 }`.
   * At level `L`, resolution is `baseU * 2^L` by `baseV * 2^L` tiles.
   */
  readonly baseResolution?: { u: number; v: number };

  gpu: SurfaceProjectionGpu;
  cpu: SurfaceProjectionCpu;
}

export type { LeafTileNodes };
