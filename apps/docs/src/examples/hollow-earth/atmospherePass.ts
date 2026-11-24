import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import {
  dot,
  exp,
  float,
  Fn,
  If,
  ivec2,
  length,
  logarithmicDepthToViewZ,
  Loop,
  max,
  min,
  mix,
  pass,
  pow,
  renderOutput,
  rtt,
  screenCoordinate,
  select,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { CLOUD_BASE, CLOUD_TOP, type HollowEarthClouds } from "./clouds";
import type { HollowEarthShading, HollowEarthUniforms } from "./shading";
import { SHELL_RADIUS } from "./world";

// oxlint-disable-next-line typescript/no-explicit-any
type TslNode = any;

/** Clouds further than this along a grazing ray are lost in the haze anyway. */
const CLOUD_MARCH_LIMIT = 320_000;

const henyeyGreenstein = (cosTheta: TslNode, g: number) =>
  float((1 - g * g) / (4 * Math.PI)).div(
    pow(float(1 + g * g).sub(cosTheta.mul(2 * g)), float(1.5)),
  );

/**
 * Raymarch the cloud deck along a view ray. Returns the light the clouds
 * send to the eye, how much of the scene behind shows through, and roughly
 * how far away the cloud is (for putting the right amount of air in front).
 *
 * The deck is a shell between two spheres, so a ray meets it in at most two
 * stretches: one through the cloud around the camera, and one on the far
 * side of the world. Both are clipped to the scene depth, so mountains
 * taller than the cloud base stand in front of it.
 */
function marchClouds(
  u: HollowEarthUniforms,
  shading: HollowEarthShading,
  clouds: HollowEarthClouds,
  rayOrigin: TslNode,
  rayDirection: TslNode,
  sceneDistance: TslNode,
  steps: number,
  farSteps: number,
) {
  const origin = vec3(rayOrigin).toVar();
  const direction = vec3(rayDirection).toVar();
  const limit = float(sceneDistance).toVar();
  const originRadius = length(origin).toVar();
  const b = dot(origin, direction).toVar();

  const roots = (radius: number) => {
    const c = originRadius.sub(radius).mul(originRadius.add(radius));
    const discriminant = b.mul(b).sub(c).toVar();
    const root = sqrt(max(discriminant, 0)).toVar();
    return {
      hit: discriminant.greaterThan(0),
      near: b.negate().sub(root).toVar(),
      far: b.negate().add(root).toVar(),
    };
  };
  // Base is the outer sphere (nearer the ground); tops are the inner one.
  const outer = roots(SHELL_RADIUS - CLOUD_BASE);
  const inner = roots(SHELL_RADIUS - CLOUD_TOP);
  const insideOuter = outer.hit.and(outer.far.greaterThan(0));
  const crossesInner = inner.hit.and(inner.far.greaterThan(0));

  const enter = max(outer.near, 0);
  const nearStart = enter.toVar();
  const nearEnd = select(crossesInner, max(inner.near, 0), outer.far).min(limit).toVar();
  const farStart = select(crossesInner, inner.far, limit).min(limit).toVar();
  const farEnd = outer.far.min(limit).toVar();

  const transmittance = float(1).toVar();
  const radiance = vec3(0).toVar();
  const weightedDistance = float(0).toVar();
  const weight = float(0).toVar();

  // Offset each pixel's samples by a different fraction of a step; the eye
  // forgives the resulting grain far more readily than banding.
  const jitter = screenCoordinate.x
    .mul(0.06711056)
    .add(screenCoordinate.y.mul(0.00583715))
    .fract()
    .mul(52.9829189)
    .fract()
    .toVar();
  const ambient = shading
    .worldshineRadiance()
    .add(vec3(0.4, 0.55, 0.9).mul(u.sunIntensity).mul(0.02))
    .toVar();

  const marchSegment = (start: TslNode, end: TslNode, count: number, bunch: boolean) => {
    const segmentLength = end.sub(start).max(0).toVar();
    If(insideOuter.and(segmentLength.greaterThan(1)), () => {
      // Long grazing stretches get finer steps close to the eye.
      const curve = bunch ? segmentLength.div(60_000).clamp(0, 1) : float(0);
      Loop(count, ({ i }: { i: TslNode }) => {
        If(transmittance.greaterThan(0.01), () => {
          const warp = (x: TslNode) => mix(x, x.mul(x), curve);
          const x0 = warp(float(i).div(count));
          const x1 = warp(float(i).add(1).div(count));
          const stepLength = segmentLength.mul(x1.sub(x0)).toVar();
          const t = start.add(segmentLength.mul(mix(x0, x1, jitter))).toVar();
          const position = origin.add(direction.mul(t)).toVar();
          const cloud = clouds.sample(position).toVar();
          const density = cloud.x;

          If(density.greaterThan(0.002), () => {
            const radius = length(position);
            const altitude = float(SHELL_RADIUS).sub(radius);
            const sun = shading
              .clearSunIrradiance(position, altitude)
              .mul(clouds.interiorLight(cloud.y));
            const cosTheta = dot(position.div(radius), direction).negate();
            // A forward lobe for the silver lining, plus a flat term standing
            // in for the many scatterings that make cloud tops white.
            const phase = henyeyGreenstein(cosTheta, 0.72).mul(0.3).add(0.26);
            const light = sun.mul(phase).add(ambient.mul(0.6));
            const stepTransmittance = exp(density.mul(stepLength).mul(-clouds.extinction));
            const opacity = float(1).sub(stepTransmittance).mul(transmittance);
            radiance.addAssign(light.mul(opacity));
            weightedDistance.addAssign(t.mul(opacity));
            weight.addAssign(opacity);
            transmittance.mulAssign(stepTransmittance);
          });
        });
      });
    });
  };

  marchSegment(nearStart, min(nearEnd, nearStart.add(CLOUD_MARCH_LIMIT)), steps, true);
  marchSegment(farStart, farEnd, farSteps, false);

  return {
    radiance,
    transmittance,
    distance: select(weight.greaterThan(1e-4), weightedDistance.div(weight.max(1e-4)), limit),
  };
}

/**
 * The atmosphere and clouds as a post-processing pass over the rendered
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
 * light and cloud — is soft. So it runs in a *reduced-resolution* target
 * (`volumeScale`), and the full-resolution composite upsamples it. Only the
 * air's transmittance, which needs no lighting or textures, is marched per
 * full-resolution pixel.
 */
export function createAtmospherePipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  u: HollowEarthUniforms,
  shading: HollowEarthShading,
  clouds: HollowEarthClouds | null,
  quality: {
    atmosphereSteps: number;
    cloudSteps: number;
    cloudFarSteps: number;
    volumeScale: number;
  },
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

  // --- Reduced resolution: everything that scatters light ------------------
  // rgb = light added along the ray, a = how much of the scene the clouds
  // let through.
  const volumeNode = rtt(
    Fn(() => {
      const ray = rayAt(uv());
      const direction = ray.direction.toVar();
      const distance = ray.distance.toVar();

      if (!clouds) {
        const air = shading.marchAtmosphere(
          view.position,
          direction,
          distance,
          quality.atmosphereSteps,
        );
        return vec4(air.inscatter, 1);
      }

      const cloud = marchClouds(
        u,
        shading,
        clouds,
        view.position,
        direction,
        distance,
        quality.cloudSteps,
        quality.cloudFarSteps,
      );
      // The clouds sit inside the air: air behind them only shows through by
      // their transmittance, and only the air in front of them veils them.
      const air = shading.marchAtmosphere(
        view.position,
        direction,
        distance,
        quality.atmosphereSteps,
        { distance: cloud.distance, transmittance: cloud.transmittance },
      );
      return vec4(
        cloud.radiance.mul(air.veilTransmittance).add(air.inscatter),
        cloud.transmittance,
      );
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
    const light = vec4(0).toVar();
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
      light.addAssign(volume.sample(tap).mul(weight));
      totalWeight.addAssign(weight);
    }
    light.divAssign(totalWeight);

    const airTransmittance = shading.marchTransmittance(
      view.position,
      ray.direction,
      distance,
      Math.max(4, Math.round(quality.atmosphereSteps / 2)),
    );
    return vec4(sceneColor.rgb.mul(light.a).mul(airTransmittance).add(light.rgb), 1);
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
