import { type ShaderNodeObject, float, int, pow, vec3, vec4 } from "three/tsl";

import { Fn, instanceIndex } from "three/tsl";
import type { StorageBufferNode } from "three/webgpu";
import { uRootOrigin, uRootSize } from "./uniforms";

export const tileData = (nodeStorage: ShaderNodeObject<StorageBufferNode>) =>
  Fn(([nodeStorage]: [ShaderNodeObject<StorageBufferNode>]) => {
    const nodeIndex = instanceIndex;
    const nodeOffset = nodeIndex.mul(int(4));
    const level = nodeStorage.element(nodeOffset);
    const nodeX = nodeStorage.element(nodeOffset.add(int(1)));
    const nodeY = nodeStorage.element(nodeOffset.add(int(2)));
    const isLeaf = nodeStorage.element(nodeOffset.add(int(3)));
    const tileSize = uRootSize.div(pow(2.0, level.toFloat()));
    const worldX = uRootOrigin.x.add(
      nodeX.add(0.5).mul(tileSize).sub(uRootSize.div(2.0))
    );
    const worldZ = uRootOrigin.z.add(
      nodeY.add(0.5).mul(tileSize).sub(uRootSize.div(2.0))
    );
    // const worldUv = vec2(worldX.div(uRootSize), worldZ.div(uRootSize));
    const worldPosition = vec3(worldX, 0, worldZ);

    return vec4(
      worldPosition.x,
      worldPosition.y,
      worldPosition.z,
      float(isLeaf)
    );
  })(nodeStorage);
