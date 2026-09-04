import type { BufferGeometry, Intersection, Raycaster } from "three";
import {
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardNodeMaterial,
  NodeMaterial,
} from "three/webgpu";
import { TerrainGeometry } from "../geometry/TerrainGeometry";
import type { TerrainRaycast } from "../query/types";
import { innerTileSegments as innerTileSegmentsParam } from "../tasks/params";

export type TerrainMeshParams = {
  innerTileSegments: number;
  maxNodes: number;
  /**
   * Material for the instanced tiles. When omitted, each `TerrainMesh`
   * creates its own `MeshStandardNodeMaterial` so meshes never share a
   * material instance by default.
   */
  material?: NodeMaterial;
  /**
   * Reverse tile triangle winding. Cube-sphere surfaces set this so the
   * planet's outer shell is front-facing and renders with `FrontSide`.
   */
  flipWinding: boolean;
};

/**
 * Default construction params. Intentionally has no `material`: a material is
 * a GPU resource, so the default is allocated lazily per mesh in the
 * constructor rather than once at module import time.
 */
export const defaultTerrainMeshParams: Omit<TerrainMeshParams, "material"> = {
  // Source of truth is the `innerTileSegments` param itself.
  innerTileSegments: innerTileSegmentsParam.get(),
  maxNodes: 1024,
  flipWinding: false,
};

/**
 * Geometry swaps are deferred one macrotask so a caller that swaps geometry
 * from inside a render callback (`useFrame`, `onBeforeRender`) never disposes
 * GPU buffers the renderer may still reference during the current frame.
 */
function disposeGeometryAfterFrame(geometry: BufferGeometry) {
  setTimeout(() => geometry.dispose());
}

export class TerrainMesh extends InstancedMesh {
  private _innerTileSegments: number;
  private _maxNodes: number;
  private _flipWinding: boolean;
  terrainRaycast: TerrainRaycast | null = null;
  constructor(params: Partial<TerrainMeshParams> = {}) {
    const { innerTileSegments, maxNodes, material, flipWinding } = {
      ...defaultTerrainMeshParams,
      ...params,
    };
    const geometry = new TerrainGeometry(innerTileSegments, true, flipWinding);
    super(geometry, material ?? new MeshStandardNodeMaterial(), maxNodes);
    this.instanceMatrix.name = "terrainInstanceMatrix";
    this.frustumCulled = false;
    this._innerTileSegments = innerTileSegments;
    this._maxNodes = maxNodes;
    this._flipWinding = flipWinding;
  }

  get innerTileSegments() {
    return this._innerTileSegments;
  }
  set innerTileSegments(tileSegments: number) {
    if (tileSegments === this._innerTileSegments) return;
    const oldGeometry = this.geometry;
    this.geometry = new TerrainGeometry(tileSegments, true, this._flipWinding);
    this._innerTileSegments = tileSegments;
    disposeGeometryAfterFrame(oldGeometry);
  }

  get flipWinding() {
    return this._flipWinding;
  }
  set flipWinding(flip: boolean) {
    if (flip === this._flipWinding) return;
    const oldGeometry = this.geometry;
    this.geometry = new TerrainGeometry(this._innerTileSegments, true, flip);
    this._flipWinding = flip;
    disposeGeometryAfterFrame(oldGeometry);
  }

  get maxNodes() {
    return this._maxNodes;
  }
  set maxNodes(maxNodes: number) {
    if (!Number.isInteger(maxNodes) || maxNodes < 1) {
      throw new Error(`Invalid maxNodes: ${maxNodes}. Must be a positive integer.`);
    }
    if (maxNodes === this._maxNodes) return;

    const oldMax = this._maxNodes;
    const nextMatrix = new Float32Array(maxNodes * 16);
    const oldMatrixArray = this.instanceMatrix.array as Float32Array;
    nextMatrix.set(oldMatrixArray.subarray(0, Math.min(oldMatrixArray.length, nextMatrix.length)));
    this.instanceMatrix = new InstancedBufferAttribute(nextMatrix, 16);
    this.instanceMatrix.name = "terrainInstanceMatrix";

    if (this.instanceColor) {
      const itemSize = this.instanceColor.itemSize;
      const nextColor = new Float32Array(maxNodes * itemSize);
      const oldColorArray = this.instanceColor.array as Float32Array;
      nextColor.set(oldColorArray.subarray(0, Math.min(oldColorArray.length, nextColor.length)));
      this.instanceColor = new InstancedBufferAttribute(nextColor, itemSize);
      this.instanceColor.name = "terrainInstanceColor";
    }

    this._maxNodes = maxNodes;
    this.count = Math.min(this.count, maxNodes);
    this.instanceMatrix.needsUpdate = true;
    if (this.instanceColor) this.instanceColor.needsUpdate = true;

    if (maxNodes < oldMax && this.count >= maxNodes) {
      this.count = maxNodes;
    }
  }

  raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    if (!this.terrainRaycast) {
      super.raycast(raycaster, intersects);
      return;
    }
    const result = this.terrainRaycast.pick(raycaster.ray);
    if (!result) return;
    intersects.push({
      distance: result.distance,
      point: result.position.clone(),
      normal: result.normal.clone(),
      object: this,
      face: null,
      faceIndex: -1,
    });
  }
}
