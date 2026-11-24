import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import {
  float,
  Fn,
  ivec2,
  logarithmicDepthToViewZ,
  pass,
  renderOutput,
  rtt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { HollowEarthShading } from "./shading";

// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

/**
 * The atmosphere as a post-processing pass over the rendered
 * scene, the way Maxime Heckel's article builds it: for each pixel, rebuild
 * the view ray, read how far away the surface is from the depth buffer, and
 * march the volume in between.
 *
 * Doing this once per *pixel* instead of once per *fragment* matters a great
 * deal here. A logarithmic depth buffer writes depth from the fragment
 * shader, which switches off early depth rejection — every hidden layer
 * (seabed under water, water under land, stacked skirts) runs its whole
 * shader before being thrown away. And near the horizon terrain triangles
 * are slivers a fraction of a pixel tall, each of which shades a full 2×2
 * block. With the march in the materials, both multiplied its cost.
 *
 * The march itself is the expensive part, and what it produces — scattered
 * light — is soft. So it runs in a *reduced-resolution* target
 * (`volumeScale`), and the full-resolution composite upsamples it. Only the
 * air's transmittance, which needs no lighting or textures, is marched per
 * full-resolution pixel.
 */
export function createAtmospherePipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  shading: HollowEarthShading,
  quality: { atmosphereSteps: number; volumeScale: number },
) {
  // The pass has its own camera uniforms: inside the full-screen quad the
  // built-in camera nodes describe the quad's camera, not the scene's.
  const view = {
    position: uniform(new THREE.Vector3()),
    world: uniform(new THREE.Matrix4()),
    projectionInverse: uniform(new THREE.Matrix4()),
    near: uniform(camera.near),
    far: uniform(camera.far),
    /** Size of the scene's colour and depth targets, in pixels. */
    sceneSize: uniform(new THREE.Vector2(1, 1)),
    /** Size of the reduced-resolution volume target, in pixels. */
    volumeSize: uniform(new THREE.Vector2(1, 1)),
  };

  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const sceneDepth = scenePass.getTextureNode("depth");

  /** World-space view ray through a screen UV, and the scene's distance along it. */
  const rayAt = (uvNode: TslNode) => {
    // Snap to the centre of the scene pixel under this UV, and take both the
    // ray and the depth from that pixel. The reduced-resolution pass lands
    // exactly on the boundary between scene pixels; casting the ray through
    // the boundary while reading depth from one side gives bands.
    const pixel = uvNode.mul(view.sceneSize).floor().clamp(vec2(0), view.sceneSize.sub(1));
    const screen = pixel.add(0.5).div(view.sceneSize);
    // The quad's UV origin is top-left; clip space is y-up.
    const ndc = vec2(screen.x.mul(2).sub(1), float(1).sub(screen.y).mul(2).sub(1));
    // Any depth gives a point on the pixel's ray; only its direction is used.
    const onRay = view.projectionInverse.mul(vec4(ndc, 0.5, 1));
    const viewDirection = onRay.xyz.div(onRay.w).normalize().toVar();
    const viewZ = logarithmicDepthToViewZ(sceneDepth.load(ivec2(pixel)).r, view.near, view.far);
    return {
      direction: view.world.mul(vec4(viewDirection, 0)).xyz.normalize(),
      distance: viewZ.div(viewDirection.z).max(float(0)),
    };
  };

  // --- Reduced resolution: the light scattered along each ray --------------
  const volumeNode = rtt(
    Fn(() => {
      const ray = rayAt(uv());
      const air = shading.marchAtmosphere(
        view.position,
        ray.direction,
        ray.distance,
        quality.atmosphereSteps,
      );
      return vec4(air.inscatter, 1);
    })(),
    null,
    null,
    { type: THREE.HalfFloatType },
  );
  // `setResolutionScale` is newer than the published typings.
  const volume = (
    volumeNode as unknown as { setResolutionScale(scale: number): typeof volumeNode }
  ).setResolutionScale(quality.volumeScale);

  // --- Full resolution: composite -----------------------------------------
  const composite = Fn(() => {
    const screen = uv();
    const ray = rayAt(screen);
    const distance = ray.distance.toVar();

    // Depth-aware upsample. Plain bilinear filtering would smear haze across
    // silhouettes (a near ridge against the far side of the world). Weight
    // the four surrounding volume texels by how closely the depth each was
    // computed for matches this pixel's.
    const texel = screen.mul(view.volumeSize).sub(0.5);
    const corner = texel.floor();
    const blend = texel.fract();
    const light = vec3(0).toVar();
    const totalWeight = float(0).toVar();
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const tap = corner.add(vec2(dx + 0.5, dy + 0.5)).div(view.volumeSize);
      const bilinear = (dx ? blend.x : float(1).sub(blend.x)).mul(
        dy ? blend.y : float(1).sub(blend.y),
      );
      const tapDistance = rayAt(tap).distance;
      const mismatch = tapDistance.sub(distance).abs().div(distance.max(1));
      const weight = bilinear.add(0.02).div(mismatch.mul(40).add(0.02)).toVar();
      light.addAssign(volume.sample(tap).rgb.mul(weight));
      totalWeight.addAssign(weight);
    }
    light.divAssign(totalWeight);

    const airTransmittance = shading.marchTransmittance(
      view.position,
      ray.direction,
      distance,
      Math.max(4, Math.round(quality.atmosphereSteps / 2)),
    );
    return vec4(sceneColor.rgb.mul(airTransmittance).add(light), 1);
  })();

  // three r183 renamed PostProcessing to RenderPipeline; the published typings
  // still only know the old name.
  const { RenderPipeline } = THREE as unknown as { RenderPipeline: typeof THREE.PostProcessing };
  const pipeline = new RenderPipeline(renderer);
  // Tone-map first, then antialias in display space. The scene is rendered
  // without multisampling, so FXAA is what smooths coastlines and limbs.
  pipeline.outputColorTransform = false;
  pipeline.outputNode = fxaa(renderOutput(composite));

  const drawingBufferSize = new THREE.Vector2();
  return {
    render() {
      camera.updateMatrixWorld();
      view.position.value.copy(camera.position);
      view.world.value.copy(camera.matrixWorld);
      view.projectionInverse.value.copy(camera.projectionMatrixInverse);
      view.near.value = camera.near;
      view.far.value = camera.far;
      renderer.getDrawingBufferSize(drawingBufferSize);
      view.sceneSize.value.copy(drawingBufferSize);
      view.volumeSize.value.set(
        Math.max(1, Math.floor(drawingBufferSize.x * quality.volumeScale)),
        Math.max(1, Math.floor(drawingBufferSize.y * quality.volumeScale)),
      );
      pipeline.render();
    },
    dispose() {
      volume.renderTarget?.dispose();
      pipeline.dispose();
    },
  };
}
