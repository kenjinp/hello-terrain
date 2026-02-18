import { task } from "@hello-terrain/work";
import { storage } from "three/tsl";
import { StorageBufferAttribute } from "three/webgpu";
import { allocSeamTable, buildSeams2to1 } from "../quadtree";
import { maxNodes } from "./params";
import { quadtreeUpdateTask, surfaceTask } from "./quadtree.task";

export const createSeamFieldContextTask = task((get, work) => {
  const capacity = get(maxNodes);
  return work(() => {
    const data = new Uint32Array(capacity * 8);
    const attribute = new StorageBufferAttribute(data, 1);
    const node = storage(attribute, "uint", capacity * 8).setName(
      "seamStorage",
    );
    return {
      data,
      attribute,
      node,
    };
  });
}).displayName("createSeamFieldContextTask");

export const seamGpuBufferTask = task((get, work) => {
  const leafSet = get(quadtreeUpdateTask);
  const seamField = get(createSeamFieldContextTask);
  const surfaceVal = get(surfaceTask);
  const seamTable = allocSeamTable(Math.floor(seamField.data.length / 8));
  seamTable.neighbors = seamField.data;

  return work(() => {
    buildSeams2to1(surfaceVal, leafSet, seamTable);
    seamField.attribute.needsUpdate = true;
    seamField.node.needsUpdate = true;
    return {
      count: seamTable.count,
      data: seamField.data,
      attribute: seamField.attribute,
      node: seamField.node,
    };
  });
}).displayName("seamGpuBufferTask");
