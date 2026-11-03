import { task } from "@hello-terrain/work";
import { int, ivec2, storage, uint, vec2 } from "three/tsl";
import { StorageBufferAttribute, type StorageBufferNode, type WebGPURenderer } from "three/webgpu";
import type { ComputePipeline } from "../gpu/compute";
import { createTileFieldStorage, loadTileField, storeTileField, type TileFieldStorage } from "../gpu/tileFieldStorage";
import { innerTileSegments, maxNodes, textureFn, textureReadback } from "./params";
import { createElevationFieldContextTask, tileNodesTask } from "./elevation-field.task";
import { createTerrainFieldTextureTask, terrainFieldStageTask } from "./terrain-field.task";
import { topologyTask } from "./quadtree.task";
import { updateUniformsTask } from "./uniforms/uniforms.task";

export interface TextureFieldContext {
  storage: TileFieldStorage;
  attribute: StorageBufferAttribute | null;
  node: StorageBufferNode | null;
  renderer?: WebGPURenderer;
  dispose(): void;
}

/** No allocation when textureFn is absent; the optional CPU mirror is uint, never float. */
export const createTextureFieldContextTask = task<{ renderer: WebGPURenderer }>((get, work, { resources }) => {
  const enabled = get(textureFn) !== null;
  const readback = get(textureReadback);
  const edge = get(innerTileSegments) + 3;
  const capacity = get(maxNodes);
  return work((previous?: TextureFieldContext | null): TextureFieldContext | null => {
    if (!enabled) { previous?.dispose(); return null; }
    if (previous && previous.storage.edgeVertexCount === edge && previous.storage.tileCount === capacity &&
      Boolean(previous.attribute) === readback && previous.renderer === resources?.renderer) return previous;
    previous?.dispose();
    const field = createTileFieldStorage(edge, capacity, resources?.renderer, { format: "r32uint" });
    field.texture.name = "terrainTextureControl";
    const attribute = readback ? new StorageBufferAttribute(new Uint32Array(edge * edge * capacity), 1) : null;
    const node = attribute ? storage(attribute, "uint", edge * edge * capacity).setName("textureControlReadback") : null;
    let disposed = false;
    return {
      storage: field, attribute, node, renderer: resources?.renderer,
      dispose() {
        if (disposed) return;
        disposed = true;
        field.texture.dispose();
        if (attribute && resources?.renderer) {
          const backend = resources.renderer.backend as unknown as {
            has(attribute: StorageBufferAttribute): boolean;
            destroyAttribute(attribute: StorageBufferAttribute): void;
          };
          if (backend.has(attribute)) backend.destroyAttribute(attribute);
        }
      },
    };
  });
}).displayName("createTextureFieldContextTask");

/** Runs after elevation edits, bounds reduction and terrain-field packing. */
export const textureFieldStageTask = task((get, work) => {
  const upstream = get(terrainFieldStageTask);
  const context = get(createTextureFieldContextTask);
  const callback = get(textureFn);
  if (!context || !callback) return work(() => upstream);
  const elevation = get(createElevationFieldContextTask);
  const terrain = get(createTerrainFieldTextureTask);
  const tile = get(tileNodesTask);
  const uniforms = get(updateUniformsTask);
  const projection = get(topologyTask).projection;
  const edge = get(innerTileSegments) + 3;
  return work((): ComputePipeline => {
    const frame = projection.gpu.textureFrame;
    if (!frame) throw new Error(`Projection ${projection.kind} must supply gpu.textureFrame to use textureFn`);
    return [...upstream, (nodeIndex, globalIndex, _uv, coordinates) => {
      const ix = int(coordinates.x), iy = int(coordinates.y);
      const position = tile.tileVertexWorldPositionCompute(nodeIndex, ix, iy);
      const normal = loadTileField(terrain, ix, iy, nodeIndex).gba.normalize();
      const up = frame(position, tile.tileFace(nodeIndex)).up;
      const control = uint(callback({
        worldPosition: position,
        rootSize: uniforms.uRootSize,
        rootUV: tile.rootUVCompute(nodeIndex, ix, iy),
        tileUV: vec2(coordinates).div(edge),
        tileLevel: tile.tileLevel(nodeIndex),
        tileSize: tile.tileSize(nodeIndex),
        tileOriginVec2: tile.tileOriginVec2(nodeIndex),
        nodeIndex: int(nodeIndex),
        fieldTexel: ivec2(coordinates),
        elevation: elevation.node.element(globalIndex),
        normal,
        slope: normal.dot(up).abs().oneMinus().clamp(),
      })).toVar();
      storeTileField(context.storage, ix, iy, nodeIndex, control);
      context.node?.element(globalIndex).assign(control);
    }];
  });
}).displayName("textureFieldStageTask");
