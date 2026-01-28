import { InstancedMesh, MeshStandardNodeMaterial, NodeMaterial } from "three/webgpu";
import { TerrainGeometry } from "../geometry/TerrainGeometry";


export type TerrainMeshParams = {
  innerTileSegments: number;
  maxNodes: number;
  material: NodeMaterial
};

export const defaultTerrainMeshParams: TerrainMeshParams = {
  innerTileSegments: 14,
  maxNodes: 2048,
  material: new MeshStandardNodeMaterial(),
};
export class TerrainMesh extends InstancedMesh {
  constructor(params: Partial<TerrainMeshParams> = defaultTerrainMeshParams) {
    const mergedParams = { ...defaultTerrainMeshParams, ...params };
    const { innerTileSegments, maxNodes, material } = mergedParams;
    const geometry = new TerrainGeometry(innerTileSegments, true);
   
    super(geometry, material, maxNodes);
  }
}
