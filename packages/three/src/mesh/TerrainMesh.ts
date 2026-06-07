import type { Intersection, Raycaster } from "three";
import {
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardNodeMaterial,
  NodeMaterial,
} from "three/webgpu";
import { TerrainGeometry } from "../geometry/TerrainGeometry";
import type { TerrainRaycast } from "../query/types";

export type TerrainMeshParams = {
  innerTileSegments: number;
  maxNodes: number;
  material: NodeMaterial;
  /**
   * Reverse tile triangle winding. Cube-sphere surfaces set this so the
   * planet's outer shell is front-facing and renders with `FrontSide`.
   */
  flipWinding: boolean;
};

export const defaultTerrainMeshParams: TerrainMeshParams = {
  innerTileSegments: 13,
  maxNodes: 1024,
  material: new MeshStandardNodeMaterial(),
  flipWinding: false,
};
export class TerrainMesh extends InstancedMesh {
  private _innerTileSegments: number;
  private _maxNodes: number;
  private _flipWinding: boolean;
  terrainRaycast: TerrainRaycast | null = null;
  constructor(params: Partial<TerrainMeshParams> = defaultTerrainMeshParams) {
    const mergedParams = { ...defaultTerrainMeshParams, ...params };
    const { innerTileSegments, maxNodes, material, flipWinding } = mergedParams;
    const geometry = new TerrainGeometry(innerTileSegments, true, flipWinding);
    super(geometry, material, maxNodes);
    this.frustumCulled = false;
    this._innerTileSegments = innerTileSegments;
    this._maxNodes = maxNodes;
    this._flipWinding = flipWinding;
  }

  get innerTileSegments() {
    return this._innerTileSegments;
  }
  set innerTileSegments(tileSegments: number) {
    const oldGeometry = this.geometry;
    this.geometry = new TerrainGeometry(tileSegments, true, this._flipWinding);
    this._innerTileSegments = tileSegments;
    setTimeout(() => oldGeometry.dispose());
  }

  get flipWinding() {
    return this._flipWinding;
  }
  set flipWinding(flip: boolean) {
    if (flip === this._flipWinding) return;
    const oldGeometry = this.geometry;
    this.geometry = new TerrainGeometry(this._innerTileSegments, true, flip);
    this._flipWinding = flip;
    setTimeout(() => oldGeometry.dispose());
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

    if (this.instanceColor) {
      const itemSize = this.instanceColor.itemSize;
      const nextColor = new Float32Array(maxNodes * itemSize);
      const oldColorArray = this.instanceColor.array as Float32Array;
      nextColor.set(oldColorArray.subarray(0, Math.min(oldColorArray.length, nextColor.length)));
      this.instanceColor = new InstancedBufferAttribute(nextColor, itemSize);
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
