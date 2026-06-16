export type {
  CpuSurfaceOps,
  FieldNormalContext,
  FieldNormalFn,
  ProjectionKind,
  ProjectionRaycastContext,
  RenderVertexPositionContext,
  RuntimeQueries,
  SurfaceKey,
  SurfaceNormalContext,
  SurfaceProjection,
  SurfaceProjectionCpu,
  SurfaceProjectionGpu,
  Vec3Like,
} from "./types";
export { createFlatProjection } from "./flat";
export { createCubeSphereProjection, type CubeSphereProjectionConfig } from "./cubeSphere";
export { createTorusProjection, type TorusProjectionConfig } from "./torus";
