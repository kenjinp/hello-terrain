import { vec3 as cpuVec3, type Vec3 } from "math";
import { Vector3 } from "three";
import { Fn, float, pow, int, cross } from "three/tsl";
import type { Node } from "three/webgpu";
import { HALF_PI } from "../gpu/tile";
import type { TileComputeParts, TileComputePartsContext } from "../gpu/tile";
import { createCurvedRenderVertexPosition } from "../gpu/worldPosition";
import { createSpherePrecisionPosition } from "../gpu/precision";
import { cubeFaceBasis, cubeFaceDirection, cubeFacePoint } from "../tsl/cubeSphere";
import {
  type Vec3Mutable,
  directionToFace,
  directionToFaceUV,
  faceUVToCube,
  latLongToDirection,
} from "../quadtree/topology/cubeSphereInverse";
import { sampleGridBilinear } from "../query/elevation-field-sampling";
import {
  cubeSphereRaycast,
  type SphereRaycastParams,
} from "../query/cpu-raycast";
import { createTerrainQuery, createTerrainSurfaceQuery } from "../query/terrain-query";
import { augmentCubeSphereSampler } from "../query/terrain-sampler";
import type { CpuTerrainCache } from "../query/cpu-terrain-cache";
import type {
  TerrainSphereQuery,
  TerrainSurfaceQuery,
  TerrainTile,
  TerrainTileBounds,
} from "../query/types";
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

export interface CubeSphereProjectionConfig {
  radius: number;
  center?: Vec3Like;
  /** When true, elevation displaces inward and skirts point outward. */
  invert?: boolean;
}

const RAYCAST_PADDING = 1;

function createSphereTileComputeParts(ctx: TileComputePartsContext): TileComputeParts {
  const { uniforms, shared } = ctx;

  const tileSize = Fn(([nodeIndex]: [Node]) => {
    const level = shared.tileLevel(nodeIndex);
    const divisor = pow(float(2), level.toFloat());
    return uniforms.uRadius.toVar().mul(float(HALF_PI)).div(divisor);
  });

  const tileVertexWorldPosition = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    const rootOrigin = uniforms.uRootOrigin.toVar();
    const faceUV = shared.tileFaceUV(nodeIndex, ix, iy);
    const basis = cubeFaceBasis(shared.tileFace(nodeIndex));
    const dir = cubeFaceDirection(basis, faceUV.x, faceUV.y);
    return rootOrigin.add(dir.mul(uniforms.uRadius.toVar()));
  });

  return {
    tileSize: (nodeIndex) => tileSize(nodeIndex),
    rootUV: (nodeIndex, ix, iy) => shared.tileFaceUV(nodeIndex, ix, iy),
    tileVertexWorldPosition: (nodeIndex, ix, iy) => tileVertexWorldPosition(nodeIndex, ix, iy),
  };
}

/** Cube-sphere projection: six faces wrapped radially onto a sphere. */
export function createCubeSphereProjection(
  config: CubeSphereProjectionConfig,
): SurfaceProjection {
  const radius = config.radius;
  const center: Vec3Like = Object.freeze({ ...(config.center ?? { x: 0, y: 0, z: 0 }) });
  const invert = config.invert ?? false;

  // Per-instance CPU scratch (no module-scope state).
  const cubeScratch: Vec3Mutable = [0, 0, 0];
  const uvScratch: [number, number] = [0, 0];
  const dirScratch: Vec3Mutable = [0, 0, 0];
  const posLeft: Vec3Mutable = [0, 0, 0];
  const posRight: Vec3Mutable = [0, 0, 0];
  const posUp: Vec3Mutable = [0, 0, 0];
  const posDown: Vec3Mutable = [0, 0, 0];

  const neighborPos = (face: number, u: number, v: number, height: number, out: Vec3Mutable) => {
    faceUVToCube(face, u, v, cubeScratch);
    const len = Math.hypot(cubeScratch[0], cubeScratch[1], cubeScratch[2]) || 1;
    const r = invert ? (radius - height) / len : (radius + height) / len;
    out[0] = cubeScratch[0] * r;
    out[1] = cubeScratch[1] * r;
    out[2] = cubeScratch[2] * r;
  };

  const surfaceOps: CpuSurfaceOps = {
    positionToKey(px, py, pz, out: SurfaceKey): boolean {
      const dx = px - center.x;
      const dy = py - center.y;
      const dz = pz - center.z;
      const len = Math.hypot(dx, dy, dz);
      if (len === 0) return false;
      const nx = dx / len;
      const ny = dy / len;
      const nz = dz / len;
      dirScratch[0] = nx;
      dirScratch[1] = ny;
      dirScratch[2] = nz;
      const face = directionToFace(dirScratch);
      directionToFaceUV(face, dirScratch, uvScratch);
      out.space = face;
      out.u = uvScratch[0];
      out.v = uvScratch[1];
      // `dir` is the outward geometric radial direction (center -> point). The
      // radius sign for inverted worlds is applied in `surfacePosition`, and the
      // inward-facing shading normal in `surfaceNormal`. Keeping `dir` outward
      // lets both reconstruct the same-side surface point and the correct face
      // UVs (directionToFaceUV expects the outward direction for `space`).
      out.dirX = nx;
      out.dirY = ny;
      out.dirZ = nz;
      return true;
    },
    surfacePosition(key, elevation, outVec) {
      const r = invert ? radius - elevation : radius + elevation;
      cpuVec3.set(outVec, center.x + key.dirX * r, center.y + key.dirY * r, center.z + key.dirZ * r);
    },
    surfaceNormal(key: SurfaceKey, ctx: SurfaceNormalContext): Vec3 {
      const scale = ctx.elevationScale;
      const duv = 1 / (ctx.innerTileSegments * 2 ** ctx.level);
      dirScratch[0] = key.dirX;
      dirScratch[1] = key.dirY;
      dirScratch[2] = key.dirZ;
      directionToFaceUV(key.space, dirScratch, uvScratch);
      const u = uvScratch[0];
      const v = uvScratch[1];

      const hLeft = sampleGridBilinear(ctx.elevation, ctx.shape, ctx.leafIndex, ctx.gx - 1, ctx.gy) * scale;
      const hRight = sampleGridBilinear(ctx.elevation, ctx.shape, ctx.leafIndex, ctx.gx + 1, ctx.gy) * scale;
      const hUp = sampleGridBilinear(ctx.elevation, ctx.shape, ctx.leafIndex, ctx.gx, ctx.gy - 1) * scale;
      const hDown = sampleGridBilinear(ctx.elevation, ctx.shape, ctx.leafIndex, ctx.gx, ctx.gy + 1) * scale;

      neighborPos(key.space, u - duv, v, hLeft, posLeft);
      neighborPos(key.space, u + duv, v, hRight, posRight);
      neighborPos(key.space, u, v - duv, hUp, posUp);
      neighborPos(key.space, u, v + duv, hDown, posDown);

      const tux = posRight[0] - posLeft[0];
      const tuy = posRight[1] - posLeft[1];
      const tuz = posRight[2] - posLeft[2];
      const tvx = posDown[0] - posUp[0];
      const tvy = posDown[1] - posUp[1];
      const tvz = posDown[2] - posUp[2];

      let nx = tuy * tvz - tuz * tvy;
      let ny = tuz * tvx - tux * tvz;
      let nz = tux * tvy - tuy * tvx;
      // Orient against the outward radial `dir`, then flip inward for inverted
      // worlds so the shading normal matches the GPU (which faces the surface).
      const outwardSign = invert ? -1 : 1;
      if ((nx * key.dirX + ny * key.dirY + nz * key.dirZ) * outwardSign < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      return cpuVec3.normalize(cpuVec3.create(), [nx, ny, nz]);
    },
  };

  return {
    kind: "cubeSphere",
    radius,
    center,
    faceOutward: !invert,

    gpu: {
      createRenderPrecision(ctx) { return createSpherePrecisionPosition({ ...ctx, radius, center, invert }); },
      renderVertexPosition(ctx: RenderVertexPositionContext): Node {
        return createCurvedRenderVertexPosition(
          ctx.leafStorage,
          ctx.uniforms,
          ctx.terrainFieldStorage,
          (tile, faceUV, displacement) => {
            const basis = cubeFaceBasis(tile.face);
            const dir = cubeFaceDirection(basis, faceUV.x, faceUV.y);
            ctx.materialContext?.datumNormalLocal.assign(invert ? dir.negate() : dir);
            const r = invert
              ? ctx.uniforms.uRadius.toVar().sub(displacement)
              : ctx.uniforms.uRadius.toVar().add(displacement);
            return ctx.uniforms.uRootOrigin.toVar().add(dir.mul(r));
          },
          ctx.tileBoundsNode,
          1, 1, ctx.materialContext,
        );
      },
      createTileComputeParts: createSphereTileComputeParts,
      createFieldNormal(ctx: FieldNormalContext): FieldNormalFn {
        return Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
          const edge = int(ctx.edgeVertexCount);
          // Clamp the outer halo's derivative stencil; render samples use the
          // inner vertices. Never read another tile's row or outside storage.
          const x = int(ix).clamp(1, ctx.edgeVertexCount - 2);
          const y = int(iy).clamp(1, ctx.edgeVertexCount - 2);
          const base = int(nodeIndex).mul(ctx.edgeVertexCount ** 2);
          const height = (gx: Node, gy: Node) => ctx.elevationFieldNode.element(base.add(gy.mul(edge)).add(gx)).mul(ctx.uniforms.uElevationScale);
          const h = height(x, y);
          const dhU = height(x.add(1), y).sub(height(x.sub(1), y));
          const dhV = height(x, y.add(1)).sub(height(x, y.sub(1)));
          const basis = cubeFaceBasis(ctx.tile.tileFace(nodeIndex));
          const uv = ctx.tile.tileFaceUV(nodeIndex, x, y);
          const cube = cubeFacePoint(basis, uv.x, uv.y);
          const length = cube.length();
          const direction = cube.div(length);
          const sign = invert ? -1 : 1;
          const shell = ctx.uniforms.uRadius.add(h.mul(sign));
          // d(normalize(c))/du = (dc/du - n dot(n,dc/du))/|c|.
          // Multiply by the small stencil span before any large position exists.
          const span = float(4).div(ctx.uniforms.uInnerTileSegments.toFloat().mul(pow(2, ctx.tile.tileLevel(nodeIndex).toFloat())));
          const metric = shell.mul(span).div(length);
          const tangentU = basis.right.sub(direction.mul(direction.dot(basis.right))).mul(metric).add(direction.mul(dhU.mul(sign)));
          const tangentV = basis.up.sub(direction.mul(direction.dot(basis.up))).mul(metric).add(direction.mul(dhV.mul(sign)));
          return cross(tangentU, tangentV).normalize().mul(sign);
        });
      },
      augmentSampler: augmentCubeSphereSampler,
    },

    cpu: {
      createSurfaceOps() {
        return surfaceOps;
      },
      createRuntimeQueries(cache: CpuTerrainCache) {
        const query = createTerrainQuery(cache);
        const surfaceQuery = createTerrainSurfaceQuery(cache);
        const sphereQuery = createCubeSphereQuery(surfaceQuery, center);
        return { query, surfaceQuery, sphereQuery };
      },
      raycast(ctx: ProjectionRaycastContext) {
        if (!ctx.sphereQuery) return null;
        const range = ctx.terrainQuery?.getGlobalElevationRange();
        const dispMax = range ? Math.max(0, range.max - center.y) : radius * 0.1;
        const outerPadding = invert ? 0 : dispMax + RAYCAST_PADDING;
        const params: SphereRaycastParams = {
          centerX: center.x,
          centerY: center.y,
          centerZ: center.z,
          radius,
          maxRadius: radius + outerPadding,
          invert,
        };
        return cubeSphereRaycast(ctx.sphereQuery, ctx.ray, params, ctx.options);
      },
    },
  };
}

/** Wrap a generic surface query with the sphere-only direction/lat-long keys. */
function createCubeSphereQuery(
  surfaceQuery: TerrainSurfaceQuery,
  center: Vec3Like,
): TerrainSphereQuery {
  const scratch = new Vector3();
  const ll: Vec3Mutable = [0, 0, 0];

  const positionFromDirection = (dx: number, dy: number, dz: number): Vector3 =>
    scratch.set(center.x + dx, center.y + dy, center.z + dz);

  return {
    get generation() {
      return surfaceQuery.generation;
    },
    getElevationByPosition: (position) => surfaceQuery.getElevationByPosition(position),
    getNormalByPosition: (position) => surfaceQuery.getNormalByPosition(position),
    sampleTerrainByPosition: (position) => surfaceQuery.sampleTerrainByPosition(position),
    getTileByPosition: (position) => surfaceQuery.getTileByPosition(position),
    getTileBoundsByPosition: (position) => surfaceQuery.getTileBoundsByPosition(position),
    sampleTerrainBatchByPosition: (positions) => surfaceQuery.sampleTerrainBatchByPosition(positions),

    getElevationByDirection: (direction) =>
      surfaceQuery.getElevationByPosition(positionFromDirection(direction.x, direction.y, direction.z)),
    getNormalByDirection: (direction) =>
      surfaceQuery.getNormalByPosition(positionFromDirection(direction.x, direction.y, direction.z)),
    sampleTerrainByDirection: (direction) =>
      surfaceQuery.sampleTerrainByPosition(positionFromDirection(direction.x, direction.y, direction.z)),
    getTileByDirection: (direction): TerrainTile | null =>
      surfaceQuery.getTileByPosition(positionFromDirection(direction.x, direction.y, direction.z)),
    getTileBoundsByDirection: (direction): TerrainTileBounds | null =>
      surfaceQuery.getTileBoundsByPosition(
        positionFromDirection(direction.x, direction.y, direction.z),
      ),

    getElevationByLatLong: (lat, lon) => {
      latLongToDirection(lat, lon, ll);
      return surfaceQuery.getElevationByPosition(positionFromDirection(ll[0], ll[1], ll[2]));
    },
    getNormalByLatLong: (lat, lon) => {
      latLongToDirection(lat, lon, ll);
      return surfaceQuery.getNormalByPosition(positionFromDirection(ll[0], ll[1], ll[2]));
    },
    sampleTerrainByLatLong: (lat, lon) => {
      latLongToDirection(lat, lon, ll);
      return surfaceQuery.sampleTerrainByPosition(positionFromDirection(ll[0], ll[1], ll[2]));
    },
    getTileByLatLong: (lat, lon) => {
      latLongToDirection(lat, lon, ll);
      return surfaceQuery.getTileByPosition(positionFromDirection(ll[0], ll[1], ll[2]));
    },
    getTileBoundsByLatLong: (lat, lon) => {
      latLongToDirection(lat, lon, ll);
      return surfaceQuery.getTileBoundsByPosition(positionFromDirection(ll[0], ll[1], ll[2]));
    },

    sampleTerrainBatchByDirection: (directions) => {
      const count = Math.floor(directions.length / 3);
      const positions = new Float64Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = center.x + (directions[i * 3] ?? 0);
        positions[i * 3 + 1] = center.y + (directions[i * 3 + 1] ?? 0);
        positions[i * 3 + 2] = center.z + (directions[i * 3 + 2] ?? 0);
      }
      return surfaceQuery.sampleTerrainBatchByPosition(positions);
    },
  };
}
