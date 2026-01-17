import type * as THREE from "three/webgpu";
import type { ThreeToJSXElements } from "@react-three/fiber";
import { TerrainGeometry } from "@hello-terrain/three";

declare module "@react-three/fiber" {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {
    terrainGeometry: ThreeToJSXElements<{
      TerrainGeometry: typeof TerrainGeometry;
    }>["terrainGeometry"];
  }
}
