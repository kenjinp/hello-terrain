import { InstancedBufferGeometry } from "three";
import { generateIndices } from "./utils";

export class InstancedTerrainGeometry extends InstancedBufferGeometry {
  constructor(resolution: number) {
    super();
    this.setIndex(generateIndices(resolution));
    // this.setAttribute(
    //   "position",
    //   new BufferAttribute(new Float32Array(generationPositions(resolution)), 2)
    // );
  }
}
