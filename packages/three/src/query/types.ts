import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
import type { SurfaceProjection, Vec3Like } from "../projection/types";
import type { ElevationCallback } from "../tsl/elevation";
import type { TerrainUniformsContext } from "../types";
import type { Ray, Vector3 } from "three";
import type {
  Node,
  StorageBufferAttribute,
  StorageBufferNode,
  UniformNode,
} from "three/webgpu";

export interface GpuSpatialIndexContext {
  data: Uint32Array<ArrayBuffer>;
  size: number;
  mask: number;
  stampGen: UniformNode<number>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

export interface TerrainSampler {
  sampleElevation: (worldX: Node, worldZ: Node) => Node;
  sampleNormal: (worldX: Node, worldZ: Node) => Node;
  sampleTerrain: (worldX: Node, worldZ: Node) => Node;
  sampleValidity: (worldX: Node, worldZ: Node) => Node;
  evaluateElevation: (worldX: Node, worldZ: Node) => Node;
  evaluateNormal: (worldX: Node, worldZ: Node, epsilon?: Node) => Node;

  // Cube-sphere samplers (present only when projection is `cubeSphere`).
  // `direction` is a vec3 from the planet center.
  /** Packed `vec4(elevation, nx, ny, nz)` where the normal is tangent-space. */
  sampleTerrainByDirection?: (direction: Node) => Node;
  sampleElevationByDirection?: (direction: Node) => Node;
  /** World-space surface normal reconstructed in the sphere tangent frame. */
  sampleNormalByDirection?: (direction: Node) => Node;
  sampleValidityByDirection?: (direction: Node) => Node;
}

export interface CreateTerrainSamplerParams {
  terrainFieldStorage: TerrainFieldStorage;
  tileBoundsNode: StorageBufferNode;
  spatialIndex: GpuSpatialIndexContext;
  uniforms: TerrainUniformsContext;
  elevationCallback: ElevationCallback;
  /** Maximum quadtree level to probe during tile lookup. */
  maxLevel: number;
  /** Active surface projection (drives optional GPU sampler augmentation). */
  projection: SurfaceProjection;
}

export interface TerrainSample {
  elevation: number;
  normal: Vector3;
  valid: boolean;
}
export interface TerrainSampleBatch {
  elevations: Float32Array;
  normals: Float32Array;
  valid: Uint8Array;
  generation: number;
}

/**
 * Result of sampling a cube-sphere surface from a direction/position/lat-long.
 *
 * `elevation` is the radial displacement above the base radius (already scaled
 * by `elevationScale`); `position` is the full world-space surface point
 * `center + direction * (radius + elevation)`.
 */
export interface TerrainSurfaceSample {
  position: Vector3;
  normal: Vector3;
  direction: Vector3;
  elevation: number;
  valid: boolean;
}

export interface TerrainSurfaceSampleBatch {
  positions: Float32Array;
  normals: Float32Array;
  elevations: Float32Array;
  valid: Uint8Array;
  generation: number;
}

export interface TerrainTile {
  /** Surface space index: 0 for flat terrain, 0..5 for cube-sphere faces. */
  space: number;
  level: number;
  x: number;
  y: number;
  index: number;
}

export interface TerrainTileBounds extends TerrainTile {
  minElevation: number;
  maxElevation: number;
}

export interface ElevationRange {
  min: number;
  max: number;
}

/**
 * Flat (heightfield) terrain query, keyed on world XZ. For cube-sphere
 * surfaces use {@link TerrainSphereQuery} instead.
 */
export interface TerrainQuery {
  getElevation(worldX: number, worldZ: number): number | null;
  getNormal(worldX: number, worldZ: number): Vector3 | null;
  getTile(worldX: number, worldZ: number): TerrainTile | null;
  getTileBounds(worldX: number, worldZ: number): TerrainTileBounds | null;
  getGlobalElevationRange(): ElevationRange | null;
  sampleTerrain(worldX: number, worldZ: number): TerrainSample;
  sampleTerrainBatch(positions: Float32Array): TerrainSampleBatch;
  readonly generation: number;
}

/**
 * Generic closed-surface terrain query, keyed on a world position projected
 * onto the surface. Exposed for every non-flat projection (cube-sphere, torus,
 * ...); `null` on flat surfaces. Elevation is the displacement above the base
 * surface (already scaled by `elevationScale`); `position` is the full
 * world-space surface point.
 *
 * Inputs accept any `{ x, y, z }` (a `THREE.Vector3` or a plain object);
 * results are `THREE.Vector3`s.
 */
export interface TerrainSurfaceQuery {
  readonly generation: number;

  getElevationByPosition(position: Vec3Like): number | null;
  getNormalByPosition(position: Vec3Like): Vector3 | null;
  sampleTerrainByPosition(position: Vec3Like): TerrainSurfaceSample;
  getTileByPosition(position: Vec3Like): TerrainTile | null;
  getTileBoundsByPosition(position: Vec3Like): TerrainTileBounds | null;

  /** Batch sample; `positions` is a Float32Array of xyz triples. */
  sampleTerrainBatchByPosition(positions: Float32Array): TerrainSurfaceSampleBatch;
}

/**
 * Cube-sphere terrain query. Extends the generic surface query with the
 * sphere-only direction/lat-long keys. A surface location is identified by a
 * direction from the planet center (the canonical form); `ByPosition` projects
 * any world point onto its direction, and `ByLatLong` takes degrees (latitude
 * `[-90, 90]`, longitude `[-180, 180]`).
 *
 * Exposed only when the active surface uses the `cubeSphere` projection
 * (otherwise `null` on the query context / runtime).
 */
export interface TerrainSphereQuery extends TerrainSurfaceQuery {
  getElevationByDirection(direction: Vec3Like): number | null;
  getElevationByLatLong(latitudeDeg: number, longitudeDeg: number): number | null;

  getNormalByDirection(direction: Vec3Like): Vector3 | null;
  getNormalByLatLong(latitudeDeg: number, longitudeDeg: number): Vector3 | null;

  sampleTerrainByDirection(direction: Vec3Like): TerrainSurfaceSample;
  sampleTerrainByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainSurfaceSample;

  getTileByDirection(direction: Vec3Like): TerrainTile | null;
  getTileByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainTile | null;

  getTileBoundsByDirection(direction: Vec3Like): TerrainTileBounds | null;
  getTileBoundsByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainTileBounds | null;

  /** Batch sample; `directions` is a Float32Array of xyz triples. */
  sampleTerrainBatchByDirection(directions: Float32Array): TerrainSurfaceSampleBatch;
}

export interface RaycastOptions {
  maxSteps?: number;
  refinementSteps?: number;
  maxDistance?: number;
}

/**
 * Shared raycast bounds for the CPU marcher. Flat raycasts use the XZ extent +
 * `[minY, maxY]`; curved projections derive their own radial shell from their
 * geometry plus the query's global elevation range, and only read `center*`.
 */
export interface TerrainRaycastConfig {
  rootSize: number;
  originX: number;
  originY: number;
  originZ: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  centerZ: number;
}

/**
 * Plain-object hit produced by the CPU marchers (`SurfaceProjectionCpu.raycast`).
 * Converted once into a {@link TerrainRaycastResult} (three.js vectors) by
 * {@link TerrainRaycast.pick}; the internals never touch three.js.
 */
export interface CpuRaycastHit {
  position: Vec3Like;
  normal: Vec3Like;
  distance: number;
}

export interface TerrainRaycastResult {
  position: Vector3;
  normal: Vector3;
  distance: number;
}

export interface TerrainRaycast {
  pick(ray: Ray, options?: RaycastOptions): TerrainRaycastResult | null;
}
