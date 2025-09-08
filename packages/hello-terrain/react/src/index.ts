import {
  TerrainGeometry as TerrainGeometryImpl,
  TerrainMesh as TerrainMeshImpl,
} from "@hello-terrain/three";
import { extend } from "@react-three/fiber";

const TerrainGeometry = extend(TerrainGeometryImpl);
const TerrainMesh = extend(TerrainMeshImpl);

export { TerrainGeometry, TerrainMesh };
