import {
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardNodeMaterial,
  NodeMaterial,
} from "three/webgpu";
import { TerrainGeometry } from "../geometry/TerrainGeometry";

export type TerrainMeshParams = {
  innerTileSegments: number;
  maxNodes: number;
  material: NodeMaterial;
};

export const defaultTerrainMeshParams: TerrainMeshParams = {
  innerTileSegments: 14,
  maxNodes: 1024,
  material: new MeshStandardNodeMaterial(),
};
export class TerrainMesh extends InstancedMesh {
  private _innerTileSegments: number;
  private _maxNodes: number;
  constructor(params: Partial<TerrainMeshParams> = defaultTerrainMeshParams) {
    const mergedParams = { ...defaultTerrainMeshParams, ...params };
    const { innerTileSegments, maxNodes, material } = mergedParams;
    const geometry = new TerrainGeometry(innerTileSegments, true);
    super(geometry, material, maxNodes);
    this.frustumCulled = false;
    this._innerTileSegments = innerTileSegments;
    this._maxNodes = maxNodes;
  }

  get innerTileSegments() {
    return this._innerTileSegments;
  }
  set innerTileSegments(tileSegments: number) {
    const oldGeometry = this.geometry;
    this.geometry = new TerrainGeometry(tileSegments, true);
    this._innerTileSegments = tileSegments;
    setTimeout(oldGeometry.dispose);
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
}
