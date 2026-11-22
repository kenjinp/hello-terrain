"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { createBodyColorNode, createCoronaColorNode, createSunColorNode } from "./materials";
import type { HollowEarthShading, HollowEarthUniforms } from "./shading";
import { type HollowEarthState, ORBITING_BODIES, SUN_RADIUS } from "./world";

/**
 * The central sun and everything that orbits it. The meshes are only what the
 * camera sees — the shadows they cast are computed analytically from the same
 * positions (see `sunVisibility` in shading.ts), so nothing here needs to be
 * in a shadow map.
 */
export function CelestialBodies({
  uniforms,
  shading,
  state,
}: {
  uniforms: HollowEarthUniforms;
  shading: HollowEarthShading;
  state: HollowEarthState;
}) {
  const bodyRefs = useRef<(THREE.Mesh | null)[]>([]);
  const nodes = useMemo(
    () => ({
      sun: createSunColorNode(uniforms, shading),
      corona: createCoronaColorNode(uniforms),
      bodies: ORBITING_BODIES.map((_, index) => createBodyColorNode(uniforms, shading, index)),
    }),
    [uniforms, shading],
  );

  useFrame(() => {
    for (let i = 0; i < ORBITING_BODIES.length; i++) {
      bodyRefs.current[i]?.position.copy(state.bodyPositions[i]);
    }
  });

  return (
    <>
      <mesh scale={SUN_RADIUS} frustumCulled={false}>
        <sphereGeometry args={[1, 64, 32]} />
        <meshBasicNodeMaterial colorNode={nodes.sun} />
      </mesh>
      <mesh scale={SUN_RADIUS * 4.5} frustumCulled={false} renderOrder={2}>
        <sphereGeometry args={[1, 64, 32]} />
        <meshBasicNodeMaterial
          colorNode={nodes.corona}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {ORBITING_BODIES.map((body, index) => (
        <mesh
          key={body.name}
          ref={(mesh) => {
            bodyRefs.current[index] = mesh;
          }}
          scale={body.radius}
          position={state.bodyPositions[index]}
        >
          <sphereGeometry args={[1, 96, 48]} />
          <meshBasicNodeMaterial colorNode={nodes.bodies[index]} />
        </mesh>
      ))}
    </>
  );
}
