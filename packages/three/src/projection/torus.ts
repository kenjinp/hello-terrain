import { Vector3 } from "three";
import { Fn, float, pow } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TileComputeParts, TileComputePartsContext } from "../gpu/tile";
import { createDisplacedSurfaceNormalFromElevationField } from "../gpu/normalField";
import { createCurvedRenderVertexPosition } from "../gpu/worldPosition";
import { torusOutwardNormal as torusOutwardNormalNode, torusPosition } from "../tsl/torus";
import {
  type TorusSurfaceParams,
  type Vec3Mutable,
  positionToTorusParams,
  torusOutwardNormal,
  torusUVToPoint,
} from "../quadtree/topology/torusInverse";
import { sampleGridBilinear } from "../query/elevation-field-sampling";
import { torusRaycast, type TorusRaycastParams } from "../query/cpu-raycast";
import { createTerrainQuery, createTerrainSurfaceQuery } from "../query/terrain-query";
import type { CpuTerrainCache } from "../query/cpu-terrain-cache";
import type {
  CpuSurfaceOps,
  FieldNormalContext,
  FieldNormalFn,
  ProjectionRaycastContext,
  ProjectionHorizonContext,
  RenderVertexPositionContext,
  SurfaceKey,
  SurfaceNormalContext,
  SurfaceProjection,
  Vec3Like,
} from "./types";

export interface TorusProjectionConfig {
  majorRadius: number;
  minorRadius: number;
  center?: Vec3Like;
  /** When true, elevation displaces inward and skirts point outward. */
  invert?: boolean;
  /** Level-0 tile count along u before LOD subdivision (defaults to 1). */
  baseU?: number;
  /** Level-0 tile count along v before LOD subdivision (defaults to 1). */
  baseV?: number;
}

const TWO_PI = Math.PI * 2;
const RAYCAST_PADDING = 1;
const ZERO_CENTER = { x: 0, y: 0, z: 0 };
const TORUS_OCCLUSION_MAX_BOUNDS_RADIUS_RATIO = 0.25;
const TORUS_BACKFACE_MARGIN_RATIO = 0.25;

function vec3CacheKey(value: Vec3Like): string {
  return `${value.x},${value.y},${value.z}`;
}

function createTorusTileComputeParts(
  ctx: TileComputePartsContext,
  geometry: {
    majorRadius: number;
    minorRadius: number;
    center: Vec3Like;
    invert: boolean;
    baseU: number;
    baseV: number;
  },
): TileComputeParts {
  const { shared } = ctx;

  const tileSize = Fn(([nodeIndex]: [Node]) => {
    const level = shared.tileLevel(nodeIndex);
    const levelScale = pow(float(2), level.toFloat());
    // Representative arc length: a tile's share of the major circumference.
    return float(TWO_PI * geometry.majorRadius).div(float(geometry.baseU).mul(levelScale));
  });

  const tileVertexWorldPosition = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    const faceUV = shared.tileFaceUV(nodeIndex, ix, iy);
    return torusPosition(geometry, faceUV.x, faceUV.y, float(0));
  });

  return {
    tileSize: (nodeIndex) => tileSize(nodeIndex),
    rootUV: (nodeIndex, ix, iy) => shared.tileFaceUV(nodeIndex, ix, iy),
    tileVertexWorldPosition: (nodeIndex, ix, iy) => tileVertexWorldPosition(nodeIndex, ix, iy),
  };
}

/** Torus (donut) projection: a single closed surface periodic in both axes. */
export function createTorusProjection(config: TorusProjectionConfig): SurfaceProjection {
  const majorRadius = config.majorRadius;
  const minorRadius = config.minorRadius;
  const center: Vec3Like = config.center ?? { x: 0, y: 0, z: 0 };
  const invert = config.invert ?? false;
  const baseU = config.baseU ?? 1;
  const baseV = config.baseV ?? 1;
  const geometry = { majorRadius, minorRadius, center, invert, baseU, baseV };
  const cacheKey = [
    "torus",
    `majorRadius=${majorRadius}`,
    `minorRadius=${minorRadius}`,
    `center=${vec3CacheKey(center)}`,
    `invert=${invert ? 1 : 0}`,
    `base=${baseU}x${baseV}`,
  ].join("|");

  // Per-instance CPU scratch (no module-scope state).
  const params: TorusSurfaceParams = { u: 0, v: 0, tubeDistance: 0 };
  const normalScratch: Vec3Mutable = [0, 0, 0];
  const posLeft: Vec3Mutable = [0, 0, 0];
  const posRight: Vec3Mutable = [0, 0, 0];
  const posUp: Vec3Mutable = [0, 0, 0];
  const posDown: Vec3Mutable = [0, 0, 0];
  const occlusionParams: TorusSurfaceParams = { u: 0, v: 0, tubeDistance: 0 };
  const occlusionPoint: Vec3Mutable = [0, 0, 0];
  const occlusionNormal: Vec3Mutable = [0, 0, 0];

  const sampleFacesCamera = (
    ctx: ProjectionHorizonContext,
    u: number,
    v: number,
    margin: number,
  ): boolean => {
    torusUVToPoint(u, v, majorRadius, minorRadius, 0, center, occlusionPoint, invert);
    torusOutwardNormal(u, v, occlusionNormal, invert);
    const viewDot =
      occlusionNormal[0] * (ctx.cameraOrigin.x - occlusionPoint[0]) +
      occlusionNormal[1] * (ctx.cameraOrigin.y - occlusionPoint[1]) +
      occlusionNormal[2] * (ctx.cameraOrigin.z - occlusionPoint[2]);
    return viewDot + margin >= 0;
  };

  const isTilePatchBackFacing = (
    ctx: ProjectionHorizonContext,
    boundsRadius: number,
  ): boolean => {
    if (
      ctx.tile.level < 2 ||
      boundsRadius > minorRadius * TORUS_OCCLUSION_MAX_BOUNDS_RADIUS_RATIO
    ) {
      return false;
    }

    const levelScale = 2 ** ctx.tile.level;
    const nU = baseU * levelScale;
    const nV = baseV * levelScale;
    const u0 = ctx.tile.x / nU;
    const u1 = (ctx.tile.x + 1) / nU;
    const v0 = ctx.tile.y / nV;
    const v1 = (ctx.tile.y + 1) / nV;
    const uc = (u0 + u1) * 0.5;
    const vc = (v0 + v1) * 0.5;
    const margin = boundsRadius * TORUS_BACKFACE_MARGIN_RATIO;

    return !(
      sampleFacesCamera(ctx, u0, v0, margin) ||
      sampleFacesCamera(ctx, u1, v0, margin) ||
      sampleFacesCamera(ctx, u0, v1, margin) ||
      sampleFacesCamera(ctx, u1, v1, margin) ||
      sampleFacesCamera(ctx, uc, vc, margin)
    );
  };

  const isTileBehindHorizon = (ctx: ProjectionHorizonContext): boolean => {
    if (invert) return false;

    const tileX = ctx.cameraOrigin.x + ctx.bounds.cx;
    const tileY = ctx.cameraOrigin.y + ctx.bounds.cy;
    const tileZ = ctx.cameraOrigin.z + ctx.bounds.cz;
    positionToTorusParams(tileX, tileY, tileZ, majorRadius, center, occlusionParams);

    const theta = TWO_PI * occlusionParams.u;
    const tubeCenterX = center.x + majorRadius * Math.sin(theta);
    const tubeCenterY = center.y;
    const tubeCenterZ = center.z + majorRadius * Math.cos(theta);

    const cameraX = ctx.cameraOrigin.x - tubeCenterX;
    const cameraY = ctx.cameraOrigin.y - tubeCenterY;
    const cameraZ = ctx.cameraOrigin.z - tubeCenterZ;
    const cameraDistance = Math.hypot(cameraX, cameraY, cameraZ);
    const boundsRadius = ctx.bounds.r * ctx.guardBandFactor;
    if (cameraDistance <= minorRadius + boundsRadius) return false;

    if (isTilePatchBackFacing(ctx, boundsRadius)) return true;

    const invCameraDistance = 1 / cameraDistance;
    const dirX = cameraX * invCameraDistance;
    const dirY = cameraY * invCameraDistance;
    const dirZ = cameraZ * invCameraDistance;

    const tileLocalX = tileX - tubeCenterX;
    const tileLocalY = tileY - tubeCenterY;
    const tileLocalZ = tileZ - tubeCenterZ;
    const tileLocalDistance = Math.hypot(tileLocalX, tileLocalY, tileLocalZ);

    if (
      tileLocalDistance > 1e-6 &&
      boundsRadius <= minorRadius * TORUS_OCCLUSION_MAX_BOUNDS_RADIUS_RATIO
    ) {
      const invTileLocalDistance = 1 / tileLocalDistance;
      const normalX = tileLocalX * invTileLocalDistance;
      const normalY = tileLocalY * invTileLocalDistance;
      const normalZ = tileLocalZ * invTileLocalDistance;
      const tileToCameraX = ctx.cameraOrigin.x - tileX;
      const tileToCameraY = ctx.cameraOrigin.y - tileY;
      const tileToCameraZ = ctx.cameraOrigin.z - tileZ;
      const viewDot =
        normalX * tileToCameraX +
        normalY * tileToCameraY +
        normalZ * tileToCameraZ;
      if (viewDot + boundsRadius < 0) return true;
    }

    const projection = tileLocalX * dirX + tileLocalY * dirY + tileLocalZ * dirZ;
    const maxTileProjection = projection + boundsRadius;

    return cameraDistance * maxTileProjection < minorRadius * minorRadius;
  };

  const surfaceOps: CpuSurfaceOps = {
    positionToKey(px, py, pz, out: SurfaceKey): boolean {
      positionToTorusParams(px, py, pz, majorRadius, center, params);
      torusOutwardNormal(params.u, params.v, normalScratch, invert);
      out.space = 0;
      out.u = params.u;
      out.v = params.v;
      out.dirX = normalScratch[0];
      out.dirY = normalScratch[1];
      out.dirZ = normalScratch[2];
      return true;
    },
    surfacePosition(key, elevation, outVec) {
      torusUVToPoint(
        key.u,
        key.v,
        majorRadius,
        minorRadius,
        elevation,
        center,
        normalScratch,
        invert,
      );
      outVec.set(normalScratch[0], normalScratch[1], normalScratch[2]);
    },
    surfaceNormal(key: SurfaceKey, ctx: SurfaceNormalContext): Vector3 {
      const scale = ctx.elevationScale;
      const levelScale = 2 ** ctx.level;
      const duvU = 1 / (ctx.innerTileSegments * baseU * levelScale);
      const duvV = 1 / (ctx.innerTileSegments * baseV * levelScale);
      const u = key.u;
      const v = key.v;

      const hLeft = sampleGridBilinear(ctx.elevation, ctx.shape, ctx.leafIndex, ctx.gx - 1, ctx.gy) * scale;
      const hRight = sampleGridBilinear(ctx.elevation, ctx.shape, ctx.leafIndex, ctx.gx + 1, ctx.gy) * scale;
      const hUp = sampleGridBilinear(ctx.elevation, ctx.shape, ctx.leafIndex, ctx.gx, ctx.gy - 1) * scale;
      const hDown = sampleGridBilinear(ctx.elevation, ctx.shape, ctx.leafIndex, ctx.gx, ctx.gy + 1) * scale;

      // Translation-invariant; use a zero center to keep the math simple.
      torusUVToPoint(u - duvU, v, majorRadius, minorRadius, hLeft, ZERO_CENTER, posLeft, invert);
      torusUVToPoint(u + duvU, v, majorRadius, minorRadius, hRight, ZERO_CENTER, posRight, invert);
      torusUVToPoint(u, v - duvV, majorRadius, minorRadius, hUp, ZERO_CENTER, posUp, invert);
      torusUVToPoint(u, v + duvV, majorRadius, minorRadius, hDown, ZERO_CENTER, posDown, invert);

      const tux = posRight[0] - posLeft[0];
      const tuy = posRight[1] - posLeft[1];
      const tuz = posRight[2] - posLeft[2];
      const tvx = posDown[0] - posUp[0];
      const tvy = posDown[1] - posUp[1];
      const tvz = posDown[2] - posUp[2];

      let nx = tuy * tvz - tuz * tvy;
      let ny = tuz * tvx - tux * tvz;
      let nz = tux * tvy - tuy * tvx;
      if (nx * key.dirX + ny * key.dirY + nz * key.dirZ < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      return new Vector3(nx, ny, nz).normalize();
    },
  };

  return {
    kind: "torus",
    cacheKey,
    radius: majorRadius + minorRadius,
    center,
    faceOutward: !invert,
    baseResolution: { u: baseU, v: baseV },

    gpu: {
      renderVertexPosition(ctx: RenderVertexPositionContext): Node {
        return createCurvedRenderVertexPosition(
          ctx.leafStorage,
          ctx.uniforms,
          ctx.terrainFieldStorage,
          (_tile, faceUV, displacement) => torusPosition(geometry, faceUV.x, faceUV.y, displacement),
          baseU,
          baseV,
          ctx.visibleSlotStorage,
        );
      },
      createTileComputeParts: (ctx) => createTorusTileComputeParts(ctx, geometry),
      createFieldNormal(ctx: FieldNormalContext): FieldNormalFn {
        const computeNormal = createDisplacedSurfaceNormalFromElevationField(
          ctx.elevationFieldNode,
          ctx.edgeVertexCount,
          (nodeIndex) => ({
            positionAt: (gx, gy, height) => {
              const uv = ctx.tile.tileFaceUV(nodeIndex, gx, gy);
              return torusPosition(geometry, uv.x, uv.y, height);
            },
            dirAt: (gx, gy) => {
              const uv = ctx.tile.tileFaceUV(nodeIndex, gx, gy);
              return torusOutwardNormalNode(uv.x, uv.y, invert);
            },
          }),
        );
        return (nodeIndex, ix, iy) =>
          computeNormal(nodeIndex, ix, iy, ctx.uniforms.uElevationScale);
      },
    },

    cpu: {
      createSurfaceOps() {
        return surfaceOps;
      },
      createRuntimeQueries(cache: CpuTerrainCache) {
        const query = createTerrainQuery(cache);
        const surfaceQuery = createTerrainSurfaceQuery(cache);
        return { query, surfaceQuery, sphereQuery: null };
      },
      raycast(ctx: ProjectionRaycastContext) {
        if (!ctx.surfaceQuery) return null;
        const range = ctx.terrainQuery?.getGlobalElevationRange();
        const dispMax = range ? Math.max(0, range.max - ctx.config.originY) : minorRadius * 0.5;
        const outerPadding = invert ? 0 : dispMax + RAYCAST_PADDING;
        const raycastParams: TorusRaycastParams = {
          centerX: center.x,
          centerY: center.y,
          centerZ: center.z,
          majorRadius,
          minorRadius,
          outerRadius: majorRadius + minorRadius + outerPadding,
          invert,
        };
        return torusRaycast(ctx.surfaceQuery, ctx.ray, raycastParams, ctx.options);
      },
      isTileBehindHorizon,
    },
  };
}
