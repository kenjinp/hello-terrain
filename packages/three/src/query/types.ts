import type { TerrainFieldStorage } from "../gpu/terrainFieldStorage";
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
  spatialIndex: GpuSpatialIndexContext;
  uniforms: TerrainUniformsContext;
  elevationCallback: ElevationCallback;
  /** Maximum quadtree level to probe during tile lookup. */
  maxLevel: number;
  projection?: import("../quadtree").SurfaceProjection;
}

export interface TerrainSample {
  elevation: number;
  normal: Vector3;
  valid: boolean;
}
export interface TerrainElevationSample {
  elevation: number;
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
 * Cube-sphere terrain query. A surface location is identified by a direction
 * from the planet center (the canonical form); `ByPosition` projects any world
 * point onto its direction, and `ByLatLong` takes degrees (latitude
 * `[-90, 90]`, longitude `[-180, 180]`). Elevation is the radial displacement
 * above the base radius.
 *
 * Exposed only when the active surface uses the `cubeSphere` projection
 * (otherwise `null` on the query context / runtime).
 */
export interface TerrainSphereQuery {
  readonly generation: number;

  getElevationByDirection(direction: Vector3): number | null;
  getElevationByPosition(position: Vector3): number | null;
  getElevationByLatLong(latitudeDeg: number, longitudeDeg: number): number | null;

  getNormalByDirection(direction: Vector3): Vector3 | null;
  getNormalByPosition(position: Vector3): Vector3 | null;
  getNormalByLatLong(latitudeDeg: number, longitudeDeg: number): Vector3 | null;

  sampleTerrainByDirection(direction: Vector3): TerrainSurfaceSample;
  sampleTerrainByPosition(position: Vector3): TerrainSurfaceSample;
  sampleTerrainByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainSurfaceSample;

  getTileByDirection(direction: Vector3): TerrainTile | null;
  getTileByPosition(position: Vector3): TerrainTile | null;
  getTileByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainTile | null;

  getTileBoundsByDirection(direction: Vector3): TerrainTileBounds | null;
  getTileBoundsByPosition(position: Vector3): TerrainTileBounds | null;
  getTileBoundsByLatLong(latitudeDeg: number, longitudeDeg: number): TerrainTileBounds | null;

  /** Batch sample; `directions` is a Float32Array of xyz triples. */
  sampleTerrainBatchByDirection(directions: Float32Array): TerrainSurfaceSampleBatch;
}

export interface RaycastOptions {
  maxSteps?: number;
  refinementSteps?: number;
  maxDistance?: number;
}

export interface TerrainRaycastResult {
  position: Vector3;
  normal: Vector3;
  distance: number;
}

export interface TerrainRaycast {
  pick(ray: Ray, options?: RaycastOptions): TerrainRaycastResult | null;
}
