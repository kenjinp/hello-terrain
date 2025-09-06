import type { TerrainGeometry } from "@hello-terrain/three";
import type { ThreeElement } from "@react-three/fiber";
import type {} from "three";

declare module "@react-three/fiber" {
  interface ThreeElements {
    terrainGeometry: ThreeElement<typeof TerrainGeometry>;
  }
}
