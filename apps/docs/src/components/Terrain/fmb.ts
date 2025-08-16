import { Fn, type ShaderNodeObject, float, vec2, vec3, wgslFn } from 'three/tsl';

export const vec2_fbm = wgslFn(/* wgsl */ `
  fn fbm(position: vec2f, iterations: i32, amplitude: f32, frequency: f32, lacunarity: f32, persistence: f32) -> f32 {
    var p1 = position;
    var a = 0.0;
    var b = amplitude;
    var d = vec2(0.0);
    let scl = frequency;

    for(var i=0; i<iterations; i++ ) {
      var n = noised(p1);
      d += n.yz;
      a += b*n.x/(dot(d,d)+1.);
      b *= -lacunarity;
      a *= persistence;
      p1 = m*p1*scl;
    }
    return a*2.0;
  }

  const m = mat2x2f(0.8, -0.6, 0.6, 0.8);

  fn noised(x: vec2f) -> vec3f {
    let p = floor(x);
    let f = fract(x);
    let u = f*f*(3.0-2.0*f);

    // Simple hash-based noise for derivatives
    let a = hash(p);
    let b = hash(p + vec2(1.0, 0.0));
    let c = hash(p + vec2(0.0, 1.0));
    let d = hash(p + vec2(1.0, 1.0));

    let noiseValue = a + (b-a)*u.x + (c-a)*u.y + (a-b-c+d)*u.x*u.y;
    let derivativeX = 6.0*f.x*(1.0-f.x)*(b-a + (a-b-c+d)*u.y);
    let derivativeY = 6.0*f.y*(1.0-f.y)*(c-a + (a-b-c+d)*u.x);

    return vec3f(noiseValue, derivativeX, derivativeY);
  }

  fn hash(p: vec2f) -> f32 {
    let p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
    let p3_2 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3_2.x + p3_2.y) * p3_2.z);
  }
      `);

export const warp_fbm = Fn(
  ({ position }: { position: ShaderNodeObject<any> }) => {
    const rotated = vec2(
      position.x.mul(0.8).sub(position.y.mul(0.6)).add(position.z.mul(0.2)),
      position.x.mul(-0.2).add(position.y.mul(0.1)).add(position.z.mul(0.9)),
    );

    const warp_factor = vec2(
      vec2_fbm(rotated.mul(17.3).add(vec3(0.1, 0.3, 1.2)), 1, 2.0, 0.5),
      vec2_fbm(rotated.mul(21.2).add(vec3(3.7, 8.1, 1.1)), 1, 2.0, 0.5),
    );

    return vec2_fbm(
      rotated.mul(19.3).add(float(4.0).mul(warp_factor)),
      1,
      2.0,
      0.5,
    );
  },
);
