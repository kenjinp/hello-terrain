import { float, int, uniform, vec3 } from "three/tsl";
import type { Vector3 } from "three/webgpu";

/**
 * Instance-specific uniforms for a TerrainMesh.
 * Each TerrainMesh gets its own set of uniforms to avoid global state conflicts.
 */
export class TerrainUniforms {
  readonly uRootOrigin: ReturnType<typeof uniform>;
  readonly uRootSize: ReturnType<typeof uniform>;
  readonly uSegments: ReturnType<typeof uniform>;
  readonly uSkirtHeight: ReturnType<typeof uniform>;
  readonly uHeightmapScale: ReturnType<typeof uniform>;

  constructor(params: {
    rootSize: number;
    innerTileSegments: number;
    skirtHeight?: number;
    heightmapScale?: number;
    instanceId?: string;
  }) {
    // Sanitize instanceId to be WGSL-compliant (replace hyphens with underscores)
    const sanitizedId = params.instanceId?.replace(/-/g, "_");
    const suffix = sanitizedId ? `_${sanitizedId}` : "";

    this.uRootOrigin = uniform(vec3(0)).setName(`uRootOrigin${suffix}`);
    this.uRootSize = uniform(float(params.rootSize)).setName(
      `uRootSize${suffix}`
    );
    this.uSegments = uniform(int(params.innerTileSegments)).setName(
      `uSegments${suffix}`
    );
    this.uSkirtHeight = uniform(float(params.skirtHeight ?? 1)).setName(
      `uSkirtHeight${suffix}`
    );
    this.uHeightmapScale = uniform(float(params.heightmapScale ?? 1)).setName(
      `uHeightmapScale${suffix}`
    );
  }

  update(position: Vector3, rootSize: number, segments: number): void {
    this.uRootOrigin.value = position;
    this.uRootSize.value = rootSize;
    this.uSegments.value = segments;
  }

  setSkirtHeight(height: number): void {
    this.uSkirtHeight.value = height;
  }

  setHeightmapScale(scale: number): void {
    this.uHeightmapScale.value = scale;
  }
}
