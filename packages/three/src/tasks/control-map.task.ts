import { task } from "@hello-terrain/work";
import { createControlMapStorage } from "../gpu/controlMap";
import { innerTileSegments, maxNodes } from "./params";

export const createControlMapContextTask = task((get, work) => {
  const edgeVertexCount = get(innerTileSegments) + 3;
  const verticesPerNode = edgeVertexCount * edgeVertexCount;
  const totalElements = get(maxNodes) * verticesPerNode;

  return work(() => createControlMapStorage(totalElements));
})
  .displayName("createControlMapContextTask")
  .cache("once");
