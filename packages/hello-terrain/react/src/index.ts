import {
  TerrainGeometry as TerrainGeometryImpl,
  TerrainMesh as TerrainMeshImpl,
} from "@hello-terrain/three";
import { extend } from "@react-three/fiber";

const TerrainGeometry = extend(TerrainGeometryImpl);
const terrainGeometry = TerrainGeometry;
const TerrainMesh = extend(TerrainMeshImpl);
const terrainMesh = TerrainMesh;

export { TerrainGeometry, terrainGeometry, TerrainMesh, terrainMesh };
