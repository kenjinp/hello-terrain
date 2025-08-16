import type { Scene, WebGLRenderer, PerspectiveCamera } from "three";

export interface TerrainConfig {
  width: number;
  height: number;
  segments: number;
  heightScale: number;
}

export class TerrainGenerator {
  private config: TerrainConfig;

  constructor(config: TerrainConfig) {
    this.config = config;
  }

  generateHeightMap(): Float32Array {
    const { width, height } = this.config;
    const heightMap = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
      heightMap[i] = Math.random() * this.config.heightScale;
    }

    return heightMap;
  }

  createTerrainGeometry(): any {
    throw new Error("Implement in subclass with Three.js dependency");
  }
}

export interface WorldRenderer {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  render(): void;
  dispose(): void;
}

export const createWorld = (_canvas: HTMLCanvasElement): WorldRenderer => {
  throw new Error("Implement with Three.js dependency");
};

export * from "./utils";
