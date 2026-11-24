import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import {
  float,
  Fn,
  logarithmicDepthToViewZ,
  pass,
  renderOutput,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { HollowEarthShading } from "./shading";

/**
 * The atmosphere as a full-screen pass over the rendered scene, the way
 * Maxime Heckel's article builds it: for each pixel, rebuild the view ray,
 * read how far away the surface is from the depth buffer, and march the air
 * in between.
 *
 * Doing this once per *pixel* instead of once per *fragment* matters a great
 * deal here. A logarithmic depth buffer writes depth from the fragment
 * shader, which switches off early depth rejection — every hidden layer
 * (seabed under water, water under land, stacked skirts) runs its whole
 * shader before being thrown away. And near the horizon terrain triangles
 * are slivers a fraction of a pixel tall, each of which shades a full 2×2
 * block. With the march in the materials, both multiplied its cost.
 */
export function createAtmospherePipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  shading: HollowEarthShading,
  steps: number,
) {
  // The pass has its own camera uniforms: inside the full-screen quad the
  // built-in camera nodes describe the quad's camera, not the scene's.
  const view = {
    position: uniform(new THREE.Vector3()),
    world: uniform(new THREE.Matrix4()),
    projectionInverse: uniform(new THREE.Matrix4()),
    near: uniform(camera.near),
    far: uniform(camera.far),
  };

  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const sceneDepth = scenePass.getTextureNode("depth");

  const composite = Fn(() => {
    const screen = uv();
    // The quad's UV origin is top-left; clip space is y-up.
    const ndc = vec2(screen.x.mul(2).sub(1), float(1).sub(screen.y).mul(2).sub(1));
    // Any depth gives a point on the pixel's ray; only its direction is used.
    const onRay = view.projectionInverse.mul(vec4(ndc, 0.5, 1));
    const viewDirection = onRay.xyz.div(onRay.w).normalize().toVar();
    const viewZ = logarithmicDepthToViewZ(sceneDepth.r, view.near, view.far);
    const distance = viewZ.div(viewDirection.z).max(float(0));
    const worldDirection = view.world.mul(vec4(viewDirection, 0)).xyz.normalize();

    const { inscatter, transmittance } = shading.marchAtmosphere(
      view.position,
      worldDirection,
      distance,
      steps,
    );
    return vec4(sceneColor.rgb.mul(transmittance).add(inscatter), 1);
  })();

  // three r183 renamed PostProcessing to RenderPipeline; the published typings
  // still only know the old name.
  const { RenderPipeline } = THREE as unknown as { RenderPipeline: typeof THREE.PostProcessing };
  const pipeline = new RenderPipeline(renderer);
  // Tone-map first, then antialias in display space. The scene is rendered
  // without multisampling, so FXAA is what smooths coastlines and limbs.
  pipeline.outputColorTransform = false;
  pipeline.outputNode = fxaa(renderOutput(composite));

  return {
    render() {
      camera.updateMatrixWorld();
      view.position.value.copy(camera.position);
      view.world.value.copy(camera.matrixWorld);
      view.projectionInverse.value.copy(camera.projectionMatrixInverse);
      view.near.value = camera.near;
      view.far.value = camera.far;
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
    },
  };
}
