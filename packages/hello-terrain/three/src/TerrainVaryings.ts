import { varyingProperty } from "three/tsl";

/**
 * Instance-specific varyings for a TerrainMesh.
 * Each TerrainMesh gets its own set of varyings to avoid global state conflicts.
 */
export class TerrainVaryings {
  readonly vGlobalVertexIndex: ReturnType<typeof varyingProperty>;
  readonly vElevation: ReturnType<typeof varyingProperty>;
  readonly vNormal: ReturnType<typeof varyingProperty>;
  // Control map varyings for smooth interpolation across triangles
  readonly vControlBaseId: ReturnType<typeof varyingProperty>;
  readonly vControlOverlayId: ReturnType<typeof varyingProperty>;
  readonly vControlBlend: ReturnType<typeof varyingProperty>;

  constructor(instanceId?: string) {
    // Sanitize instanceId to be WGSL-compliant (replace hyphens with underscores)
    const sanitizedId = instanceId?.replace(/-/g, "_");
    const suffix = sanitizedId ? `_${sanitizedId}` : "";

    this.vGlobalVertexIndex = varyingProperty(
      "int",
      `vGlobalVertexIndex${suffix}`
    );
    this.vElevation = varyingProperty("f32", `vElevation${suffix}`);
    this.vNormal = varyingProperty("vec3", `vNormal${suffix}`);
    // Control map values as floats for smooth interpolation
    this.vControlBaseId = varyingProperty("f32", `vControlBaseId${suffix}`);
    this.vControlOverlayId = varyingProperty(
      "f32",
      `vControlOverlayId${suffix}`
    );
    this.vControlBlend = varyingProperty("f32", `vControlBlend${suffix}`);
  }
}
