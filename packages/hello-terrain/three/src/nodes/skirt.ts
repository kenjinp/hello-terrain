import { Fn, float, int, uv, vertexIndex } from "three/tsl";
import type { TSL } from "three/webgpu";
import { uSegments } from "./uniforms";

export const isSkirtVertex: TSL.ShaderNodeObject<TSL.ShaderCallNodeInternal> =
  Fn(() => {
    const vIndex = int(vertexIndex);
    const segments = uSegments.toVar();
    const segmentEdges = int(segments.add(3));
    const vx = vIndex.mod(segmentEdges);
    const vy = vIndex.div(segmentEdges);
    const last = segmentEdges.sub(int(1));
    const isSkirtVertex = vx
      .equal(int(0))
      .or(vx.equal(last))
      .or(vy.equal(int(0)))
      .or(vy.equal(last));
    return isSkirtVertex;
  })();

export const isSkirtFragment: TSL.OperatorNodeParameter = Fn(() => {
  const ux = uv().x;
  const uy = uv().y;
  const segments = uSegments.toVar();
  const segmentCount = segments.add(2);
  const segmentStep = float(1).div(segmentCount);
  const innerX = ux
    .greaterThan(segmentStep)
    .and(ux.lessThan(segmentStep.oneMinus()));
  const innerY = uy
    .greaterThan(segmentStep)
    .and(uy.lessThan(segmentStep.oneMinus()));
  const isSkirtFragment = innerX.and(innerY).not();
  return isSkirtFragment;
})();
