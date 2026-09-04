import type { Topology } from "../quadtree/types";

/** World-config values shared by the GPU uniforms and the CPU query/raycast. */
export type TerrainWorldConfig = {
  /** Root tile edge size in world units (feeds `uRootSize`). */
  rootSize: number;
  /** World-space terrain origin / surface center (feeds `uRootOrigin`). */
  origin: { x: number; y: number; z: number };
  /** Representative surface radius (feeds `uRadius`; curved surfaces only). */
  radius: number;
};

/**
 * Resolve the world configuration the pipeline should use, with the topology
 * as the single owner and the legacy params only as a fallback.
 *
 * Precedence (per field):
 * - `rootSize`: `topology.rootSize` → `fallback.rootSize`
 * - `origin`:   `topology.origin` → `topology.projection.center` → `fallback.origin`
 * - `radius`:   `topology.projection.radius` → `fallback.radius`
 *
 * Pure and allocation-light: returns the same object references it was given
 * (no copies), so callers may hold onto the result for the current run.
 */
export function resolveTerrainWorldConfig(
  topology: Topology,
  fallback: TerrainWorldConfig,
): TerrainWorldConfig {
  const projection = topology.projection;
  return {
    rootSize: topology.rootSize ?? fallback.rootSize,
    origin: topology.origin ?? projection.center ?? fallback.origin,
    radius: projection.radius ?? fallback.radius,
  };
}
