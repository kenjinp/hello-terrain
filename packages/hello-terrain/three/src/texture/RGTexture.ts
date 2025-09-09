import { DataTexture, RGFormat } from "three/webgpu";

export class RGTexture extends DataTexture {
  constructor(width: number, height: number) {
    const tempdist = ((height - 1) ** 2 + (width - 1) ** 2) ** 0.5;
    const uint16max = 2 ** 16 - 1;
    const temp = new Uint16Array(height * width);

    for (let hi = 0; hi < height; hi++) {
      for (let wi = 0; wi < width; wi++) {
        const pos = hi * width + wi;
        temp[pos] = (Math.sqrt(wi ** 2 + hi ** 2) / tempdist) * uint16max;
      }
    }

    super(new Uint8Array(temp.buffer), width, height, RGFormat);
    this.needsUpdate = true;
  }
}
