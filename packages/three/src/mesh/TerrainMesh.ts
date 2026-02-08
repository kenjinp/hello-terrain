import { InstancedMesh, MeshStandardNodeMaterial, NodeMaterial } from "three/webgpu";
import { TerrainGeometry } from "../geometry/TerrainGeometry";

export type TerrainMeshParams = {
  innerTileSegments: number;
  maxNodes: number;
  material: NodeMaterial;
};

export const defaultTerrainMeshParams: TerrainMeshParams = {
  innerTileSegments: 14,
  maxNodes: 2048,
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
    this._maxNodes = maxNodes;
  }
}
