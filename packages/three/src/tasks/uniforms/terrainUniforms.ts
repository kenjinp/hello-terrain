import { float, int, uniform } from "three/tsl";
import { UniformNode, Vector3, Vector3Like } from "three/webgpu";

export interface TerrainUniformsParams {
  rootSize: number;
  rootOrigin: Vector3Like;
  innerTileSegments: number;
  skirtScale: number;
  heightmapScale: number;
  instanceId: string;
}

export interface TerrainUniformsContext {
  uRootOrigin: UniformNode<Vector3>;
  uRootSize: UniformNode<number>;
  uInnerTileSegments: UniformNode<number>;
  uSkirtScale: UniformNode<number>;
  uHeightmapScale: UniformNode<number>;
}

/**
 * Factory function for instance-specific uniforms for a TerrainMesh.
 * Each TerrainMesh gets its own set of uniforms to avoid global state conflicts.
 */
export function createTerrainUniforms(params: TerrainUniformsParams): TerrainUniformsContext {
  // Sanitize instanceId to be WGSL-compliant (replace hyphens with underscores)
  const sanitizedId = params.instanceId?.replace(/-/g, "_");
  const suffix = sanitizedId ? `_${sanitizedId}` : "";

  const uRootOrigin = uniform(
    new Vector3(params.rootOrigin.x, params.rootOrigin.y, params.rootOrigin.z),
  ).setName(`uRootOrigin${suffix}`);
  const uRootSize = uniform(float(params.rootSize)).setName(`uRootSize${suffix}`);
  const uInnerTileSegments = uniform(int(params.innerTileSegments)).setName(
    `uInnerTileSegments${suffix}`,
  );
  const uSkirtScale = uniform(float(params.skirtScale)).setName(`uSkirtScale${suffix}`);
  const uHeightmapScale = uniform(float(params.heightmapScale)).setName(`uHeightmapScale${suffix}`);

  return {
    uRootOrigin,
    uRootSize,
    uInnerTileSegments,
    uSkirtScale,
    uHeightmapScale,
  };
}
