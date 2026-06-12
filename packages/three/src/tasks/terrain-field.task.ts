import { task } from "@hello-terrain/work";
import { Fn, cross, float, int, vec3 } from "three/tsl";
import type { Node, WebGPURenderer } from "three/webgpu";
import type { ComputePipeline } from "../gpu/compute";
import type { createTileCompute } from "../gpu/tile";
import {
  createTerrainFieldStorage,
  packTerrainFieldSample,
  storeTerrainField,
} from "../gpu/terrainFieldStorage";
import { cubeFaceBasis, cubeFaceDirection } from "../tsl/cubeSphere";
import type { TopologyProjection } from "../quadtree";
import {
  elevationFieldStageTask,
  createElevationFieldContextTask,
  tileNodesTask,
} from "./elevation-field.task";
import { topologyTask } from "./quadtree.task";
import { innerTileSegments, maxNodes, terrainFieldFilter } from "./params";
import { updateUniformsTask } from "./uniforms/uniforms.task";

// ── Storage buffer context ──────────────────────────────────────────────

export const createTerrainFieldTextureTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const edgeVertexCount = get(innerTileSegments) + 3;
    const maxNodesValue = get(maxNodes);
    const filter = get(terrainFieldFilter);
    return work(() =>
      createTerrainFieldStorage(
        edgeVertexCount,
        maxNodesValue,
        resources?.renderer,
        { filter },
      ),
    );
  },
).displayName("createTerrainFieldTextureTask");

/**
 * Build a TSL function that computes the world-space surface normal at a grid
 * point on a flat surface, by sampling the four cardinal neighbors in the
 * elevation field buffer and using central differences.
 *
 * Returns a TSL function `(nodeIndex, tileSize, ix, iy, elevationScale) =>
 * vec3` (the unit world-space normal). The flat normal lives in the XZ plane
 * with `+Y` up, so it is already a world-space vector.
 */
function createNormalFromElevationField(
  elevationFieldNode: Node,
  edgeVertexCount: number,
) {
  return Fn(
    ([nodeIndex, tileSize, ix, iy, elevationScale]: [
      Node,
      Node,
      Node,
      Node,
      Node,
    ]) => {
      const iEdge = int(edgeVertexCount);
      const verticesPerNode = iEdge.mul(iEdge);
      const baseOffset = int(nodeIndex).mul(verticesPerNode);

      const xLeft = int(ix).sub(int(1));
      const xRight = int(ix).add(int(1));
      const yUp = int(iy).sub(int(1));
      const yDown = int(iy).add(int(1));

      const hLeft = elevationFieldNode
        .element(baseOffset.add(int(iy).mul(iEdge).add(xLeft)))
        .mul(elevationScale);
      const hRight = elevationFieldNode
        .element(baseOffset.add(int(iy).mul(iEdge).add(xRight)))
        .mul(elevationScale);
      const hUp = elevationFieldNode
        .element(baseOffset.add(yUp.mul(iEdge).add(int(ix))))
        .mul(elevationScale);
      const hDown = elevationFieldNode
        .element(baseOffset.add(yDown.mul(iEdge).add(int(ix))))
        .mul(elevationScale);

      const innerSegments = float(iEdge).sub(float(3));
      const stepWorld = tileSize.div(innerSegments);
      const inv2Step = float(0.5).div(stepWorld);
      const dhdx = float(hRight).sub(float(hLeft)).mul(inv2Step);
      const dhdz = float(hDown).sub(float(hUp)).mul(inv2Step);

      return vec3(dhdx.negate(), float(1), dhdz.negate()).normalize();
    },
  );
}

/**
 * Build a TSL function that computes the world-space surface normal at a grid
 * point on a cube-sphere.
 *
 * Rather than differencing heights in face-local `(u, v)` space (which ignores
 * the non-uniform cube->sphere metric and decomposes the result in a per-face
 * tangent frame — the source of seam discontinuities), this reconstructs the
 * world positions of the four cardinal neighbors on the displaced sphere
 * (`dir * (radius + height)`) and takes the cross product of the spanning
 * tangents. The result is metric- and curvature-correct and frame-independent,
 * so neighboring tiles on different faces converge to the same normal at a
 * shared edge.
 *
 * Returns a TSL function `(nodeIndex, ix, iy, elevationScale, radius) => vec3`.
 */
function createSphereNormalFromElevationField(
  elevationFieldNode: Node,
  edgeVertexCount: number,
  tile: ReturnType<typeof createTileCompute>,
) {
  return Fn(
    ([nodeIndex, ix, iy, elevationScale, radius]: [
      Node,
      Node,
      Node,
      Node,
      Node,
    ]) => {
      const iEdge = int(edgeVertexCount);
      const verticesPerNode = iEdge.mul(iEdge);
      const baseOffset = int(nodeIndex).mul(verticesPerNode);

      const xLeft = int(ix).sub(int(1));
      const xRight = int(ix).add(int(1));
      const yUp = int(iy).sub(int(1));
      const yDown = int(iy).add(int(1));

      const heightAt = (gx: Node, gy: Node) =>
        elevationFieldNode
          .element(baseOffset.add(gy.mul(iEdge).add(gx)))
          .mul(elevationScale);

      const basis = cubeFaceBasis(tile.tileFace(nodeIndex));
      const positionAt = (gx: Node, gy: Node, height: Node) => {
        const uv = tile.tileFaceUV(nodeIndex, gx, gy);
        return cubeFaceDirection(basis, uv.x, uv.y).mul(radius.add(height));
      };

      const pLeft = positionAt(xLeft, int(iy), heightAt(xLeft, int(iy)));
      const pRight = positionAt(xRight, int(iy), heightAt(xRight, int(iy)));
      const pUp = positionAt(int(ix), yUp, heightAt(int(ix), yUp));
      const pDown = positionAt(int(ix), yDown, heightAt(int(ix), yDown));

      const tangentU = pRight.sub(pLeft);
      const tangentV = pDown.sub(pUp);
      const normal = cross(tangentU, tangentV).normalize();

      // Orient outward (radially away from the planet center).
      const centerUV = tile.tileFaceUV(nodeIndex, int(ix), int(iy));
      const dir = cubeFaceDirection(basis, centerUV.x, centerUV.y);
      return normal.mul(normal.dot(dir).sign());
    },
  );
}

// ── Compute stage ───────────────────────────────────────────────────────

/**
 * Normal field compute stage — reads height neighbors from the elevation field
 * buffer, computes surface normals via central differences, packs XZ
 * components into a u32 via `packHalf2x16`, and writes to the normal field
 * storage buffer.
 *
 * Accumulates the upstream elevation pipeline via `get(elevationFieldStageTask)`.
 */
export const terrainFieldStageTask = task((get, work) => {
  const upstream = get(elevationFieldStageTask);
  const elevationFieldContext = get(createElevationFieldContextTask);
  const terrainFieldStorage = get(createTerrainFieldTextureTask);
  const tileEdgeVertexCount = get(innerTileSegments) + 3;
  const tile = get(tileNodesTask);
  const uniforms = get(updateUniformsTask);
  const projection: TopologyProjection = get(topologyTask).projection ?? "flat";

  return work((): ComputePipeline => {
    const computeFlatNormal = createNormalFromElevationField(
      elevationFieldContext.node,
      tileEdgeVertexCount,
    );
    const computeSphereNormal = createSphereNormalFromElevationField(
      elevationFieldContext.node,
      tileEdgeVertexCount,
      tile,
    );
    return [
      ...upstream,
      (nodeIndex, globalVertexIndex, _uv, localCoordinates) => {
        const ix = int(localCoordinates.x);
        const iy = int(localCoordinates.y);
        const height = elevationFieldContext.node.element(globalVertexIndex);

        // Compute the world-space normal from the elevation field and pack the
        // full normal (Nx, Ny, Nz) alongside the height into RGBA.
        const normal =
          projection === "cubeSphere"
            ? computeSphereNormal(
                nodeIndex,
                ix,
                iy,
                uniforms.uElevationScale,
                uniforms.uRadius,
              )
            : computeFlatNormal(
                nodeIndex,
                tile.tileSize(nodeIndex),
                ix,
                iy,
                uniforms.uElevationScale,
              );

        storeTerrainField(
          terrainFieldStorage,
          ix,
          iy,
          nodeIndex,
          packTerrainFieldSample(height, normal),
        );
      },
    ];
  });
}).displayName("terrainFieldStageTask");
