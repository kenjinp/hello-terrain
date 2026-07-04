import { task } from "@hello-terrain/work";
import { Fn, If, Loop, float, int, localId, max, min, storage, uint, workgroupArray, workgroupBarrier, workgroupId } from "three/tsl";
import type { StorageBufferNode } from "three/webgpu";
import { StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import {
  TILE_BOUNDS_FLOATS_PER_TILE,
  TILE_BOUNDS_LOD_MAX_OFFSET,
  TILE_BOUNDS_LOD_MIN_OFFSET,
  TILE_BOUNDS_PACK_MAX_OFFSET,
  TILE_BOUNDS_PACK_MIN_OFFSET,
} from "../gpu/terrainFieldStorage";
import { createElevationFieldContextTask } from "./elevation-field.task";
import { innerTileSegments, maxNodes } from "./params";
import { dirtyVisibleSlotStorageTask } from "./quadtree.task";

export interface TileBoundsContext {
  data: Float32Array<ArrayBuffer>;
  attribute: StorageBufferAttribute;
  node: StorageBufferNode;
}

const WGSIZE = 64;

function buildReductionKernel(
  elevationFieldNode: StorageBufferNode,
  boundsNode: StorageBufferNode,
  dirtyVisibleSlotNode: StorageBufferNode,
  verticesPerNode: number,
  edgeVertexCount: number,
) {
  const elemsPerThread = Math.ceil(verticesPerNode / WGSIZE);

  return Fn(() => {
    const sharedLodMin = workgroupArray("float", WGSIZE);
    const sharedLodMax = workgroupArray("float", WGSIZE);
    const sharedPackMin = workgroupArray("float", WGSIZE);
    const sharedPackMax = workgroupArray("float", WGSIZE);

    const tid = int(localId.x);
    const dispatchIndex = uint(workgroupId.z);
    const fieldSlot = dirtyVisibleSlotNode.element(dispatchIndex).toUint();
    const baseOffset = fieldSlot.mul(uint(verticesPerNode));

    const start = tid.mul(int(elemsPerThread));
    const end = min(start.add(int(elemsPerThread)), int(verticesPerNode));

    const localLodMin = float(1e10).toVar("localLodMin");
    const localLodMax = float(-1e10).toVar("localLodMax");
    const localPackMin = float(1e10).toVar("localPackMin");
    const localPackMax = float(-1e10).toVar("localPackMax");

    // LOD bounds describe the real surface relief, so the outermost skirt ring
    // (which samples elevation outside the tile) must not widen the range.
    const edge = int(edgeVertexCount);
    const lastEdge = int(edgeVertexCount - 1);

    Loop({ start, end, type: "int", condition: "<" }, ({ i }) => {
      const ix = int(i).mod(edge);
      const iy = int(i).div(edge);
      const isSkirt = ix
        .equal(int(0))
        .or(ix.equal(lastEdge))
        .or(iy.equal(int(0)))
        .or(iy.equal(lastEdge));
      const h = elevationFieldNode.element(baseOffset.add(i));
      localPackMin.assign(min(localPackMin, h));
      localPackMax.assign(max(localPackMax, h));
      If(isSkirt.not(), () => {
        localLodMin.assign(min(localLodMin, h));
        localLodMax.assign(max(localLodMax, h));
      });
    });

    sharedLodMin.element(tid).assign(localLodMin);
    sharedLodMax.element(tid).assign(localLodMax);
    sharedPackMin.element(tid).assign(localPackMin);
    sharedPackMax.element(tid).assign(localPackMax);

    workgroupBarrier();

    If(tid.equal(int(0)), () => {
      const finalLodMin = float(1e10).toVar("finalLodMin");
      const finalLodMax = float(-1e10).toVar("finalLodMax");
      const finalPackMin = float(1e10).toVar("finalPackMin");
      const finalPackMax = float(-1e10).toVar("finalPackMax");

      Loop(WGSIZE, ({ i }) => {
        finalLodMin.assign(min(finalLodMin, sharedLodMin.element(i)));
        finalLodMax.assign(max(finalLodMax, sharedLodMax.element(i)));
        finalPackMin.assign(min(finalPackMin, sharedPackMin.element(i)));
        finalPackMax.assign(max(finalPackMax, sharedPackMax.element(i)));
      });

      const outIdx = int(fieldSlot).mul(int(TILE_BOUNDS_FLOATS_PER_TILE));
      boundsNode.element(outIdx.add(int(TILE_BOUNDS_LOD_MIN_OFFSET))).assign(finalLodMin);
      boundsNode.element(outIdx.add(int(TILE_BOUNDS_LOD_MAX_OFFSET))).assign(finalLodMax);
      boundsNode.element(outIdx.add(int(TILE_BOUNDS_PACK_MIN_OFFSET))).assign(finalPackMin);
      boundsNode.element(outIdx.add(int(TILE_BOUNDS_PACK_MAX_OFFSET))).assign(finalPackMax);
    });
  })()
    .computeKernel([WGSIZE, 1, 1])
    .setName("tileBoundsReduction");
}

export function runTileBoundsReduction(
  renderer: WebGPURenderer,
  boundsContext: TileBoundsContext & { kernel: ReturnType<typeof buildReductionKernel> },
  leafCount: number,
): void {
  if (leafCount > 0) {
    renderer.compute(boundsContext.kernel, [1, 1, leafCount]);
  }
}

export const tileBoundsContextTask = task((get, work) => {
  const elevationFieldContext = get(createElevationFieldContextTask);
  const dirtyVisibleSlotStorage = get(dirtyVisibleSlotStorageTask);
  const maxNodesValue = get(maxNodes);
  const edgeVertexCount = get(innerTileSegments) + 3;

  return work((): TileBoundsContext & { kernel: ReturnType<typeof buildReductionKernel> } => {
    const floatCount = maxNodesValue * TILE_BOUNDS_FLOATS_PER_TILE;
    const data = new Float32Array(floatCount);
    const attribute = new StorageBufferAttribute(data, 1);
    attribute.name = "tileBounds";
    const node = storage(attribute, "float", floatCount).setName(
      "tileBounds",
    ) as StorageBufferNode;
    const verticesPerNode = edgeVertexCount * edgeVertexCount;
    const kernel = buildReductionKernel(
      elevationFieldContext.node,
      node,
      dirtyVisibleSlotStorage.node,
      verticesPerNode,
      edgeVertexCount,
    );
    return { data, attribute, node, kernel };
  });
}).displayName("tileBoundsContextTask");
