"use client";

import { useRef, useMemo, createContext, useContext, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// ============================================================================
// Types & Configuration
// ============================================================================

export interface ContourBackgroundOptions {
  /** Line color in light mode [r, g, b] normalized 0-1 */
  lightModeColor?: [number, number, number];
  /** Line color in dark mode [r, g, b] normalized 0-1 */
  darkModeColor?: [number, number, number];
  /** Line opacity in light mode (0-1) */
  lightModeOpacity?: number;
  /** Line opacity in dark mode (0-1) */
  darkModeOpacity?: number;
  /** Number of contour lines */
  contourCount?: number;
  /** Scale of the noise pattern (smaller = larger features) */
  scale?: number;
  /** Animation speed multiplier */
  speed?: number;
  /** Line thickness in pixels */
  lineWidth?: number;
  /** Number of noise octaves (1-4) for terrain complexity */
  octaves?: number;
  /** Depth fade intensity (0 = no fade, 1 = full fade) */
  depthFade?: number;
  /** Mouse parallax intensity for desktop (0 = disabled) */
  mouseParallax?: number;
  /** Gyroscope influence intensity for mobile (0 = disabled) */
  gyroInfluence?: number;
}

const defaultOptions: Required<ContourBackgroundOptions> = {
  lightModeColor: [0.42, 0.54, 0.66], // Steel blue
  darkModeColor: [0.38, 0.55, 0.62], // Muted teal
  lightModeOpacity: 0.2,
  darkModeOpacity: 0.2,
  contourCount: 18,
  scale: 1.5,
  speed: 0.5,
  lineWidth: 0.6,
  octaves: 10,
  depthFade: 0.4,
  mouseParallax: 0.15,
  gyroInfluence: 0.3,
};

// Context to pass options to the plane component
const ContourOptionsContext =
  createContext<Required<ContourBackgroundOptions>>(defaultOptions);

// ============================================================================
// Shaders
// ============================================================================

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uDarkMode;
  uniform float uPixelRatio;
  
  // Configurable uniforms
  uniform vec3 uLightModeColor;
  uniform vec3 uDarkModeColor;
  uniform float uLightModeOpacity;
  uniform float uDarkModeOpacity;
  uniform float uContourCount;
  uniform float uScale;
  uniform float uSpeed;
  uniform float uLineWidth;
  uniform float uOctaves;
  uniform float uDepthFade;
  
  // Motion uniforms
  uniform vec2 uMouseOffset;      // Mouse position offset (-1 to 1)
  uniform vec2 uGyroOffset;       // Gyroscope tilt offset
  uniform float uMouseParallax;   // Mouse parallax intensity
  uniform float uGyroInfluence;   // Gyro influence intensity
  
  varying vec2 vUv;
  
  // Simplex 2D noise
  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
  
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
      + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
      dot(x12.zw,x12.zw)), 0.0);
    m = m*m;
    m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  
  // Fractal Brownian Motion for more natural terrain
  float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    
    for (int i = 0; i < 4; i++) {
      if (i >= octaves) break;
      value += amplitude * snoise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    
    return value;
  }
  
  // Pixel-perfect contour line using screen-space derivatives
  float contourLine(float value, float lineWidth) {
    float fw = fwidth(value);
    float dist = abs(fract(value - 0.5) - 0.5);
    float pixelDist = dist / fw;
    return 1.0 - smoothstep(lineWidth - 0.5, lineWidth + 0.5, pixelDist);
  }
  
  void main() {
    vec2 uv = vUv;
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    
    // Calculate motion offset from mouse (desktop) or gyro (mobile)
    vec2 motionOffset = uMouseOffset * uMouseParallax + uGyroOffset * uGyroInfluence;
    
    // Scale and animate the noise with motion offset
    float timeScale = 0.025 * uSpeed;
    vec2 noiseCoord = uv * aspect * uScale 
      + vec2(uTime * timeScale, uTime * timeScale * 0.6) 
      + motionOffset;
    
    // Get noise value with configurable octaves
    float noise = fbm(noiseCoord, int(uOctaves));
    
    // Scale noise for contour density
    float contourValue = noise * uContourCount;
    
    // Get pixel-perfect contour line
    float line = contourLine(contourValue, uLineWidth);
    
    // Add subtle variation based on the contour level for depth effect
    float level = floor(contourValue + 0.5);
    float levelFade = (1.0 - uDepthFade) + uDepthFade * sin(level * 0.4 + 1.0);
    line *= levelFade;
    
    // Color and opacity based on theme
    vec3 lineColor = mix(uLightModeColor, uDarkModeColor, uDarkMode);
    float baseOpacity = mix(uLightModeOpacity, uDarkModeOpacity, uDarkMode);
    float alpha = line * baseOpacity;
    
    gl_FragColor = vec4(lineColor, alpha);
  }
`;

// ============================================================================
// Components
// ============================================================================

function ContourPlane() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { size } = useThree();
  const options = useContext(ContourOptionsContext);

  // Motion state refs (for smooth interpolation)
  const mouseTarget = useRef(new THREE.Vector2(0, 0));
  const mouseCurrent = useRef(new THREE.Vector2(0, 0));
  const gyroTarget = useRef(new THREE.Vector2(0, 0));
  const gyroCurrent = useRef(new THREE.Vector2(0, 0));
  const isMobile = useRef(false);

  // Detect mobile and set up event listeners
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Detect touch device
    isMobile.current = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    // Mouse tracking for desktop
    const handleMouseMove = (e: MouseEvent) => {
      if (isMobile.current) return;
      // Normalize to -1 to 1 range, centered
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = -((e.clientY / window.innerHeight) * 2 - 1); // Invert Y
      mouseTarget.current.set(x, y);
    };

    // Gyroscope/accelerometer for mobile
    const handleDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (!isMobile.current) return;
      // Beta: front-to-back tilt (-180 to 180), Gamma: left-to-right tilt (-90 to 90)
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;

      // Normalize to roughly -1 to 1 range
      // Beta: when phone is flat, beta ≈ 0; tilted forward, beta > 0
      // Gamma: tilted left, gamma < 0; tilted right, gamma > 0
      const normalizedBeta = Math.max(-1, Math.min(1, beta / 45));
      const normalizedGamma = Math.max(-1, Math.min(1, gamma / 45));

      gyroTarget.current.set(normalizedGamma, -normalizedBeta);
    };

    // Add event listeners
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    // Request permission for DeviceOrientation on iOS 13+
    const requestGyroPermission = async () => {
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        // @ts-expect-error - iOS-specific API
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        try {
          // @ts-expect-error - iOS-specific API
          const permission = await DeviceOrientationEvent.requestPermission();
          if (permission === "granted") {
            window.addEventListener(
              "deviceorientation",
              handleDeviceOrientation,
              { passive: true }
            );
          }
        } catch {
          // Permission denied or not available
        }
      } else {
        // Non-iOS or older devices
        window.addEventListener("deviceorientation", handleDeviceOrientation, {
          passive: true,
        });
      }
    };

    if (isMobile.current) {
      requestGyroPermission();
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("deviceorientation", handleDeviceOrientation);
    };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uDarkMode: { value: 0 },
      uPixelRatio: {
        value: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
      // Configurable uniforms
      uLightModeColor: { value: new THREE.Vector3(...options.lightModeColor) },
      uDarkModeColor: { value: new THREE.Vector3(...options.darkModeColor) },
      uLightModeOpacity: { value: options.lightModeOpacity },
      uDarkModeOpacity: { value: options.darkModeOpacity },
      uContourCount: { value: options.contourCount },
      uScale: { value: options.scale },
      uSpeed: { value: options.speed },
      uLineWidth: { value: options.lineWidth },
      uOctaves: { value: options.octaves },
      uDepthFade: { value: options.depthFade },
      // Motion uniforms
      uMouseOffset: { value: new THREE.Vector2(0, 0) },
      uGyroOffset: { value: new THREE.Vector2(0, 0) },
      uMouseParallax: { value: options.mouseParallax },
      uGyroInfluence: { value: options.gyroInfluence },
    }),
    [options]
  );

  useFrame(({ clock, gl }) => {
    if (meshRef.current) {
      const material = meshRef.current.material as THREE.ShaderMaterial;
      material.uniforms.uTime.value = clock.getElapsedTime();

      // Check dark mode
      const isDarkMode = document.documentElement.classList.contains("dark");
      material.uniforms.uDarkMode.value = isDarkMode ? 1 : 0;

      // Update resolution with actual pixel dimensions
      const pixelRatio = gl.getPixelRatio();
      material.uniforms.uResolution.value.set(
        size.width * pixelRatio,
        size.height * pixelRatio
      );
      material.uniforms.uPixelRatio.value = pixelRatio;

      // Smoothly interpolate motion values (lerp factor for smooth movement)
      const lerpFactor = 0.01;

      // Mouse interpolation
      mouseCurrent.current.lerp(mouseTarget.current, lerpFactor);
      material.uniforms.uMouseOffset.value.copy(mouseCurrent.current);

      // Gyro interpolation
      gyroCurrent.current.lerp(gyroTarget.current, lerpFactor);
      material.uniforms.uGyroOffset.value.copy(gyroCurrent.current);
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
      />
    </mesh>
  );
}

export interface ContourBackgroundProps extends ContourBackgroundOptions {
  /** Additional CSS class name */
  className?: string;
}

export function ContourBackground({
  className,
  ...options
}: ContourBackgroundProps) {
  const mergedOptions = useMemo(
    () => ({ ...defaultOptions, ...options }),
    [options]
  );

  return (
    <ContourOptionsContext.Provider value={mergedOptions}>
      <div id="contour-background" className={className} aria-hidden="true">
        <Canvas
          gl={{
            alpha: true,
            antialias: false,
            powerPreference: "low-power",
          }}
          dpr={[1, 2]}
          camera={{ position: [0, 0, 1] }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          <ContourPlane />
        </Canvas>
      </div>
    </ContourOptionsContext.Provider>
  );
}
