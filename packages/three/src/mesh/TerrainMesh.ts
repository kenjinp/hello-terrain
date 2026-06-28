import type { Intersection, Raycaster } from "three";
import {
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardNodeMaterial,
  NodeMaterial,
} from "three/webgpu";
import { TerrainGeometry, type TerrainGeometryOptions } from "../geometry/TerrainGeometry";
import type { TerrainRaycast } from "../query/types";
import { innerTileSegments as innerTileSegmentsParam } from "../tasks/params";

export type TerrainMeshParams = {
  innerTileSegments: number;
  maxNodes: number;
  material: NodeMaterial;
  /**
   * Reverse tile triangle winding. Cube-sphere surfaces set this so the
   * planet's outer shell is front-facing and renders with `FrontSide`.
   */
  flipWinding: boolean;
  /**
   * Keep the CPU-generated normal attribute on the tile geometry. The default
   * terrain shader writes normals from the computed terrain field, but Three's
   * standard WebGPU material path still uses the presence of the geometry
   * normal attribute to select the fast normal pipeline.
   */
  includeGeometryNormals: boolean;
};

function createDefaultTerrainMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  // Three's WebGPU backend labels render shader modules `vertex_<name>` /
  // `fragment_<name>` from the material name, which makes the terrain draw
  // identifiable in GPU captures (Xcode/Metal, chrome://tracing).
  material.name = "terrain";
  return material;
}

export const defaultTerrainMeshParams: TerrainMeshParams = {
  // Source of truth is the `innerTileSegments` param itself.
  innerTileSegments: innerTileSegmentsParam.get(),
  maxNodes: 1024,
  material: createDefaultTerrainMaterial(),
  flipWinding: false,
  includeGeometryNormals: true,
};

function createTerrainMeshGeometry(
  innerTileSegments: number,
  flipWinding: boolean,
  includeGeometryNormals: boolean,
) {
  const options: TerrainGeometryOptions = {
    includeNormals: includeGeometryNormals,
  };
  return new TerrainGeometry(innerTileSegments, true, flipWinding, options);
}

export class TerrainMesh extends InstancedMesh {
  private _innerTileSegments: number;
  private _maxNodes: number;
  private _flipWinding: boolean;
  private _includeGeometryNormals: boolean;
  terrainRaycast: TerrainRaycast | null = null;
  constructor(params: Partial<TerrainMeshParams> = defaultTerrainMeshParams) {
    const mergedParams = { ...defaultTerrainMeshParams, ...params };
    const { innerTileSegments, maxNodes, material, flipWinding, includeGeometryNormals } =
      mergedParams;
    const geometry = createTerrainMeshGeometry(
      innerTileSegments,
      flipWinding,
      includeGeometryNormals,
    );
    if (!material.name) material.name = "terrain";
    super(geometry, material, maxNodes);
    this.instanceMatrix.name = "terrainInstanceMatrix";
    this.frustumCulled = false;
    this._innerTileSegments = innerTileSegments;
    this._maxNodes = maxNodes;
    this._flipWinding = flipWinding;
    this._includeGeometryNormals = includeGeometryNormals;
  }

  get innerTileSegments() {
    return this._innerTileSegments;
  }
  set innerTileSegments(tileSegments: number) {
    if (tileSegments === this._innerTileSegments) return;
    const oldGeometry = this.geometry;
    this.geometry = createTerrainMeshGeometry(
      tileSegments,
      this._flipWinding,
      this._includeGeometryNormals,
    );
    this._innerTileSegments = tileSegments;
    setTimeout(() => oldGeometry.dispose());
  }

  get flipWinding() {
    return this._flipWinding;
  }
  set flipWinding(flip: boolean) {
    if (flip === this._flipWinding) return;
    const oldGeometry = this.geometry;
    this.geometry = createTerrainMeshGeometry(
      this._innerTileSegments,
      flip,
      this._includeGeometryNormals,
    );
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
