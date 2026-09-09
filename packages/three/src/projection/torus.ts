import { vec3 as cpuVec3, type Vec3 } from "math";
import { createTorusPrecisionPosition } from "../gpu/precision";
import { Fn, float, pow, int, sin, cos, cross, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TileComputeParts, TileComputePartsContext } from "../gpu/tile";
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
  const center: Vec3Like = Object.freeze({ ...(config.center ?? { x: 0, y: 0, z: 0 }) });
  const invert = config.invert ?? false;
  const baseU = config.baseU ?? 1;
  const baseV = config.baseV ?? 1;
  const zeroCenter = { x: 0, y: 0, z: 0 };
  const geometry = { majorRadius, minorRadius, center, invert, baseU, baseV };

  // Per-instance CPU scratch (no module-scope state).
  const params: TorusSurfaceParams = { u: 0, v: 0, tubeDistance: 0 };
  const normalScratch: Vec3Mutable = [0, 0, 0];
  const posLeft: Vec3Mutable = [0, 0, 0];
  const posRight: Vec3Mutable = [0, 0, 0];
  const posUp: Vec3Mutable = [0, 0, 0];
  const posDown: Vec3Mutable = [0, 0, 0];

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
      cpuVec3.set(outVec, normalScratch[0], normalScratch[1], normalScratch[2]);
    },
    surfaceNormal(key: SurfaceKey, ctx: SurfaceNormalContext): Vec3 {
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
      torusUVToPoint(u - duvU, v, majorRadius, minorRadius, hLeft, zeroCenter, posLeft, invert);
      torusUVToPoint(u + duvU, v, majorRadius, minorRadius, hRight, zeroCenter, posRight, invert);
      torusUVToPoint(u, v - duvV, majorRadius, minorRadius, hUp, zeroCenter, posUp, invert);
      torusUVToPoint(u, v + duvV, majorRadius, minorRadius, hDown, zeroCenter, posDown, invert);

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
      return cpuVec3.normalize(cpuVec3.create(), [nx, ny, nz]);
    },
  };

  return {
    kind: "torus",
    radius: majorRadius + minorRadius,
    center,
    faceOutward: !invert,
    baseResolution: { u: baseU, v: baseV },

    gpu: {
      createRenderPrecision(ctx) { return createTorusPrecisionPosition({ ...ctx, ...geometry }); },
      renderVertexPosition(ctx: RenderVertexPositionContext): Node {
        return createCurvedRenderVertexPosition(
          ctx.leafStorage,
          ctx.uniforms,
          ctx.terrainFieldStorage,
          (_tile, faceUV, displacement) => {
            ctx.materialContext?.datumNormalLocal.assign(torusOutwardNormalNode(faceUV.x, faceUV.y, invert));
            return torusPosition(geometry, faceUV.x, faceUV.y, displacement);
          },
          ctx.tileBoundsNode,
          baseU,
          baseV,
          ctx.materialContext,
        );
      },
      createTileComputeParts: (ctx) => createTorusTileComputeParts(ctx, geometry),
      createFieldNormal(ctx: FieldNormalContext): FieldNormalFn {
        return Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
          const edge = int(ctx.edgeVertexCount), x = int(ix).clamp(1, ctx.edgeVertexCount - 2), y = int(iy).clamp(1, ctx.edgeVertexCount - 2);
          const base = int(nodeIndex).mul(ctx.edgeVertexCount ** 2);
          const height = (gx: Node, gy: Node) => ctx.elevationFieldNode.element(base.add(gy.mul(edge)).add(gx)).mul(ctx.uniforms.uElevationScale);
          const sign = invert ? -1 : 1;
          const h = height(x, y).mul(sign);
          const dhU = height(x.add(1), y).sub(height(x.sub(1), y)).mul(sign);
          const dhV = height(x, y.add(1)).sub(height(x, y.sub(1))).mul(sign);
          const uv = ctx.tile.tileFaceUV(nodeIndex, x, y);
          const theta = uv.x.mul(2 * Math.PI), phi = uv.y.mul(2 * Math.PI);
          const sT = sin(theta), cT = cos(theta), sP = sin(phi), cP = cos(phi);
          const direction = vec3(cP.mul(sT), sP, cP.mul(cT));
          const span = float(4 * Math.PI).div(ctx.uniforms.uInnerTileSegments.toFloat().mul(pow(2, ctx.tile.tileLevel(nodeIndex).toFloat())));
          const tube = h.add(minorRadius);
          const tangentU = vec3(cT, 0, sT.negate()).mul(tube.mul(cP).add(majorRadius).mul(span).div(baseU)).add(direction.mul(dhU));
          const tangentV = vec3(sP.negate().mul(sT), cP, sP.negate().mul(cT)).mul(tube.mul(span).div(baseV)).add(direction.mul(dhV));
          return cross(tangentU, tangentV).normalize().mul(sign);
        });
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
    },
  };
}
