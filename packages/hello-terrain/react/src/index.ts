import { TerrainGeometry as TerrainGeometryImpl } from "@hello-terrain/three";
import { extend } from "@react-three/fiber";

const TerrainGeometry = extend(TerrainGeometryImpl);

export { TerrainGeometry };
