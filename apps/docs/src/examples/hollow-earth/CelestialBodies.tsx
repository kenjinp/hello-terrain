"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { createBodyColorNode, createCoronaColorNode, createSunColorNode } from "./materials";
import type { HollowEarthShading, HollowEarthUniforms } from "./shading";
import {
  type HollowEarthState,
  LIGHT_BODY_INDICES,
  NYX_INDEX,
  ORBITING_BODIES,
  SUN_RADIUS,
} from "./world";

/**
 * The central sun and everything that orbits it. The meshes are only what the
 * camera sees — the shadows they cast are computed analytically from the same
 * positions (see `lightVisibility` in shading.ts), so nothing here needs to be
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
  const coronaRefs = useRef<(THREE.Mesh | null)[]>([]);
  const nodes = useMemo(
    () => ({
      sun: createSunColorNode(uniforms, shading),
      // One glow per light: the sun, then each lamp.
      coronas: uniforms.lights.map((_, lightIndex) => createCoronaColorNode(uniforms, lightIndex)),
      bodies: ORBITING_BODIES.map((_, index) => createBodyColorNode(uniforms, shading, index)),
    }),
    [uniforms, shading],
  );

  useFrame(() => {
    for (let i = 0; i < ORBITING_BODIES.length; i++) {
      const mesh = bodyRefs.current[i];
      if (!mesh) continue;
      mesh.position.copy(state.bodyPositions[i]);
      // Nyx only exists in the light system that needs it.
      if (i === NYX_INDEX) mesh.visible = state.nyxPresent;
    }
    LIGHT_BODY_INDICES.forEach((bodyIndex, slot) => {
      coronaRefs.current[slot]?.position.copy(state.bodyPositions[bodyIndex]);
    });
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
          colorNode={nodes.coronas[0]}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {LIGHT_BODY_INDICES.map((bodyIndex, slot) => (
        <mesh
          key={`corona-${ORBITING_BODIES[bodyIndex].name}`}
          ref={(mesh) => {
            coronaRefs.current[slot] = mesh;
          }}
          scale={ORBITING_BODIES[bodyIndex].radius * 3.2}
          position={state.bodyPositions[bodyIndex]}
          frustumCulled={false}
          renderOrder={2}
        >
          <sphereGeometry args={[1, 48, 24]} />
          <meshBasicNodeMaterial
            colorNode={nodes.coronas[slot + 1]}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
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
