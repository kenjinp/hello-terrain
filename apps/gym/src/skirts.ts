import { float, vec4 } from "three/tsl";
import {
  WebGPURenderer,
  MeshBasicNodeMaterial,
  Scene,
  PerspectiveCamera,
  RenderTarget,
  DoubleSide,
  NoToneMapping,
} from "three/webgpu";
import {
  createTerrain,
  createTerrainBinding,
  createFlatTopology,
  createCubeSphereTopology,
  createTorusTopology,
} from "@hello-terrain/three";
import type { GymResult } from "../../../packages/three/gym/report";

/** Render only skirt triangles: zero depth must collapse, positive depth must rasterize. */
export async function runSkirts(capabilities: GymResult["capabilities"]): Promise<GymResult> {
  const result: GymResult = {
    status: "passed",
    capabilities,
    assertions: [],
    metrics: {},
    samples: [],
  };
  const renderer = new WebGPURenderer();
  await renderer.init();
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0, 0);
  const target = new RenderTarget(128, 128);
  const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(110, 80, 130);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const segments = 9,
    edge = segments + 3;
  const outer = (index: number) =>
    index % edge === 0 ||
    index % edge === edge - 1 ||
    Math.floor(index / edge) === 0 ||
    Math.floor(index / edge) === edge - 1;
  try {
    for (const [name, topology] of [
      ["flat", createFlatTopology({ rootSize: 64, origin: { x: 0, y: 0, z: 0 } })],
      ["sphere", createCubeSphereTopology({ radius: 32 })],
      ["torus", createTorusTopology({ majorRadius: 32, minorRadius: 12 })],
    ] as const) {
      for (const depth of [0, 8]) {
        const material = new MeshBasicNodeMaterial({ side: DoubleSide });
        material.outputNode = vec4(1, 0, 0, 1);
        const terrain = createTerrain({
          renderer,
          topology,
          innerTileSegments: segments,
          maxNodes: 256,
          maxLevel: 0,
          skirtScale: depth,
          elevation: () => float(0),
          elevationRange: { min: 0, max: 0 },
          queries: { readback: "disabled" },
        });
        const binding = createTerrainBinding(terrain, { material });
        const scene = new Scene();
        scene.add(binding.mesh);
        try {
          const update = await terrain.update(binding.viewFromCamera(camera, 128));
          if (update.status === "error") throw update.error;
          const geometry = binding.mesh.geometry,
            indices = geometry.index!;
          const skirtIndices: number[] = [];
          for (let i = 0; i < indices.count; i += 3) {
            const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
            if (triangle.some(outer)) skirtIndices.push(...triangle);
          }
          geometry.setIndex(skirtIndices);
          renderer.setRenderTarget(target);
          await renderer.renderAsync(scene, camera);
          const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 128, 128);
          let covered = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 128) covered++;
          result.assertions.push({
            checkpoint: `${name}-${depth}`,
            name: "skirt-triangle-coverage",
            pass: depth === 0 ? covered === 0 : covered > 30,
            actual: covered,
            expected: depth === 0 ? "0 pixels: collapsed ring" : ">30 pixels: extruded walls",
          });
        } finally {
          renderer.setRenderTarget(null);
          await binding.dispose();
          await terrain.dispose();
          material.dispose();
        }
      }
    }
    if (result.assertions.some((assertion) => !assertion.pass)) result.status = "failed";
    return result;
  } finally {
    target.dispose();
    renderer.dispose();
  }
}
