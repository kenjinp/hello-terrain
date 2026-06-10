"use client";

import { ExamplesCanvas } from "@/components/ExamplesCanvas";
import { FpsDebug } from "@/components/FpsDebug";
import { CharacterModel } from "@/examples/character/CharacterModel";
import type { CharacterMotionState } from "@/examples/character/useCharacterController";
import { useKeyboardInput } from "@/examples/character/useKeyboardInput";
import { createPlanetColorNode, createPlanetElevation } from "@/examples/terrain/planetNoise";
import { Terrain, useTerrain, type TerrainHandle } from "@hello-terrain/react";
import { createCubeSphereSurface } from "@hello-terrain/three";
import { Environment } from "@react-three/drei";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useControls, useCreateStore } from "leva";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, MathUtils, Matrix4, Ray, Vector3 } from "three";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";
import * as THREE from "three/webgpu";

extend(THREE as any);

type LevaStore = ReturnType<typeof useCreateStore>;

const PLANET_CENTER = new Vector3(0, 0, 0);
/** Distance the character's pivot rides above the sampled ground. */
const RIDE_HEIGHT = 0.6;

export type SphereCharacterSnapshot = {
  position: Vector3;
  speed: number;
  altitude: number;
  isGrounded: boolean;
  state: CharacterMotionState;
  isPointerLocked: boolean;
};

function getMotionState(
  speed: number,
  isGrounded: boolean,
  radialVelocity: number,
  sprint: boolean,
): CharacterMotionState {
  if (!isGrounded) return radialVelocity > 0.05 ? "jumping" : "falling";
  if (speed < 0.25) return "idle";
  return sprint ? "sprinting" : "walking";
}

/**
 * A spherical-planet character controller.
 *
 * Movement happens in the tangent plane of the sphere, "down" is the radial
 * direction toward the planet center, and the ground is found with a radial
 * `raycast.pick` (the cube-sphere terrain raycaster). The follow camera orbits
 * the character with its up-vector aligned to the local surface normal.
 */
function SphereCharacter({
  terrain,
  radius,
  elevationScale,
  walkSpeed,
  sprintSpeed,
  gravity,
  jumpSpeed,
  sensitivity,
  cameraDistance,
  positionRef,
  onUpdate,
}: {
  terrain: TerrainHandle;
  radius: number;
  elevationScale: number;
  walkSpeed: number;
  sprintSpeed: number;
  gravity: number;
  jumpSpeed: number;
  sensitivity: number;
  cameraDistance: number;
  positionRef: React.MutableRefObject<Vector3>;
  onUpdate: (snapshot: SphereCharacterSnapshot) => void;
}) {
  const { gl, camera } = useThree();
  const inputRef = useKeyboardInput(true);
  const groupRef = useRef<Group>(null);

  const tangVelRef = useRef(new Vector3());
  const radialVelRef = useRef(0);
  const groundedRef = useRef(false);
  const faceDirRef = useRef(new Vector3(0, 0, 1));
  // Persistent, parallel-transported camera forward (a tangent direction).
  // Tracking this instead of a yaw angle against a global "north" reference
  // keeps walking straight from curving as you cross the sphere.
  const camForwardRef = useRef(new Vector3(0, 0, 1));
  const yawDeltaRef = useRef(0);
  const camPitchRef = useRef(0.35);
  const pointerLockedRef = useRef(false);
  const prevJumpRef = useRef(false);
  const turnRateRef = useRef(0);
  const speedRef = useRef(0);
  const [motionState, setMotionState] = useState<CharacterMotionState>("falling");

  const scratch = useMemo(
    () => ({
      up: new Vector3(0, 1, 0),
      newUp: new Vector3(0, 1, 0),
      horiz: new Vector3(),
      right: new Vector3(),
      moveDir: new Vector3(),
      targetVel: new Vector3(),
      head: new Vector3(),
      camPos: new Vector3(),
      camRadial: new Vector3(),
      rayOrigin: new Vector3(),
      ray: new Ray(),
      prevFace: new Vector3(0, 0, 1),
      xAxis: new Vector3(),
      basis: new Matrix4(),
    }),
    [],
  );

  // Pointer-lock mouse look: orbit the follow camera around the character.
  // Yaw is accumulated as a delta (applied about the local up each frame) so it
  // composes with the parallel-transported forward; pitch is an absolute angle.
  useEffect(() => {
    const el = gl.domElement;
    const requestLock = () => {
      if (document.pointerLockElement !== el) void el.requestPointerLock();
    };
    const onLockChange = () => {
      pointerLockedRef.current = document.pointerLockElement === el;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!pointerLockedRef.current) return;
      yawDeltaRef.current -= event.movementX * sensitivity * 0.01;
      camPitchRef.current = MathUtils.clamp(
        camPitchRef.current - event.movementY * sensitivity * 0.01,
        // Allow looking from below the horizon (up at the sky) over the head
        // and down at the feet.
        -1.35,
        1.45,
      );
    };
    el.addEventListener("click", requestLock);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);
    return () => {
      el.removeEventListener("click", requestLock);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, [gl, sensitivity]);

  useFrame((_state, dt) => {
    if (!terrain.ready) return;
    const delta = Math.min(dt, 1 / 20);
    const input = inputRef.current;
    const raycast = terrain.runtime.raycast;
    const sphereQuery = terrain.runtime.sphereQuery;
    const pos = positionRef.current;

    // --- Local frame: radial up. ---
    scratch.up.copy(pos).sub(PLANET_CENTER);
    let r = scratch.up.length();
    if (r < 1e-5) {
      scratch.up.set(0, 1, 0);
      r = 1;
    } else {
      scratch.up.divideScalar(r);
    }

    // Parallel-transport the camera forward onto the current tangent plane,
    // then apply any accumulated mouse yaw about the up axis. This keeps the
    // heading stable as `up` rotates while walking (no sideways drift).
    const fwd = camForwardRef.current;
    fwd.addScaledVector(scratch.up, -fwd.dot(scratch.up));
    if (fwd.lengthSq() < 1e-8) {
      // Degenerate (forward parallel to up) -> pick any tangent direction.
      fwd
        .set(scratch.up.z, scratch.up.x, scratch.up.y)
        .addScaledVector(
          scratch.up,
          -scratch.up.dot(new Vector3(scratch.up.z, scratch.up.x, scratch.up.y)),
        );
    }
    fwd.normalize();
    if (yawDeltaRef.current !== 0) {
      fwd.applyAxisAngle(scratch.up, yawDeltaRef.current);
      yawDeltaRef.current = 0;
      fwd.addScaledVector(scratch.up, -fwd.dot(scratch.up)).normalize();
    }

    scratch.horiz.copy(fwd);
    scratch.right.copy(scratch.up).cross(scratch.horiz).normalize();

    // --- Desired tangential velocity from input, relative to the camera. ---
    const forwardInput = (input.forward ? 1 : 0) + (input.backward ? -1 : 0);
    const strafeInput = (input.right ? 1 : 0) + (input.left ? -1 : 0);
    scratch.moveDir
      .copy(scratch.horiz)
      .multiplyScalar(forwardInput)
      .addScaledVector(scratch.right, strafeInput);
    const wantsMove = scratch.moveDir.lengthSq() > 1e-6;
    if (wantsMove) scratch.moveDir.normalize();
    const targetSpeed = wantsMove ? (input.sprint ? sprintSpeed : walkSpeed) : 0;
    scratch.targetVel.copy(scratch.moveDir).multiplyScalar(targetSpeed);

    const blend = 1 - Math.exp(-10 * delta);
    tangVelRef.current.lerp(scratch.targetVel, blend);
    // Keep velocity strictly tangent to the sphere.
    tangVelRef.current.addScaledVector(scratch.up, -tangVelRef.current.dot(scratch.up));

    // --- Jump + radial gravity. ---
    const jumpJustPressed = input.jump && !prevJumpRef.current;
    prevJumpRef.current = input.jump;
    if (jumpJustPressed && groundedRef.current) {
      radialVelRef.current = jumpSpeed;
      groundedRef.current = false;
    } else {
      radialVelRef.current -= gravity * delta;
    }

    // --- Integrate: slide tangentially at constant radius, then move radially. ---
    pos.addScaledVector(tangVelRef.current, delta);
    scratch.newUp.copy(pos).sub(PLANET_CENTER);
    const slidR = scratch.newUp.length();
    if (slidR < 1e-5) scratch.newUp.copy(scratch.up);
    else scratch.newUp.divideScalar(slidR);
    r += radialVelRef.current * delta;
    pos.copy(PLANET_CENTER).addScaledVector(scratch.newUp, r);
    scratch.up.copy(scratch.newUp);

    // --- Ground detection via a radial raycast (with a query fallback). ---
    let groundR: number | null = null;
    if (raycast) {
      scratch.rayOrigin
        .copy(PLANET_CENTER)
        .addScaledVector(scratch.up, radius + elevationScale + 10);
      scratch.ray.origin.copy(scratch.rayOrigin);
      scratch.ray.direction.copy(scratch.up).negate();
      const hit = raycast.pick(scratch.ray, {
        maxSteps: 160,
        refinementSteps: 8,
        maxDistance: elevationScale + 60,
      });
      if (hit) groundR = hit.position.distanceTo(PLANET_CENTER);
    }
    if (groundR == null && sphereQuery) {
      const elev = sphereQuery.getElevationByPosition(pos);
      if (elev != null) groundR = radius + elev;
    }

    if (groundR != null) {
      const desiredR = groundR + RIDE_HEIGHT;
      if (r <= desiredR && radialVelRef.current <= 0) {
        r = desiredR;
        radialVelRef.current = 0;
        groundedRef.current = true;
        pos.copy(PLANET_CENTER).addScaledVector(scratch.up, r);
      } else if (r > desiredR + 0.25) {
        groundedRef.current = false;
      }
    }

    // --- Facing + orientation. ---
    const speed = tangVelRef.current.length();
    speedRef.current = speed;
    if (speed > 0.1) {
      faceDirRef.current.copy(tangVelRef.current).divideScalar(speed);
    }
    // Re-project facing onto the (possibly rotated) tangent plane.
    faceDirRef.current.addScaledVector(scratch.up, -faceDirRef.current.dot(scratch.up)).normalize();

    // Signed turn rate about the up axis, for the model's lean animation.
    scratch.xAxis.copy(scratch.prevFace).cross(faceDirRef.current);
    const sinTurn = scratch.xAxis.dot(scratch.up);
    const cosTurn = scratch.prevFace.dot(faceDirRef.current);
    turnRateRef.current = Math.atan2(sinTurn, cosTurn) / Math.max(delta, 1e-4);
    scratch.prevFace.copy(faceDirRef.current);

    const group = groupRef.current;
    if (group) {
      scratch.xAxis.copy(scratch.up).cross(faceDirRef.current).normalize();
      scratch.basis.makeBasis(scratch.xAxis, scratch.up, faceDirRef.current);
      group.position.copy(pos);
      group.quaternion.setFromRotationMatrix(scratch.basis);
    }

    // --- Follow camera: orbits the head, up = surface normal. ---
    // Negative pitch dips the camera behind/below so the view tilts up toward
    // the sky; positive pitch lifts it overhead looking down at the feet.
    scratch.head.copy(pos).addScaledVector(scratch.up, 1.15);
    const cosPitch = Math.cos(camPitchRef.current);
    const sinPitch = Math.sin(camPitchRef.current);
    scratch.camPos
      .copy(scratch.head)
      .addScaledVector(scratch.horiz, -cameraDistance * cosPitch)
      .addScaledVector(scratch.up, cameraDistance * sinPitch);

    // Keep the camera above the terrain so looking up doesn't clip underground.
    scratch.camRadial.copy(scratch.camPos).sub(PLANET_CENTER);
    const camDist = scratch.camRadial.length();
    if (camDist > 1e-5) {
      scratch.camRadial.divideScalar(camDist);
      const camElev = sphereQuery?.getElevationByPosition(scratch.camPos) ?? 0;
      const minDist = radius + camElev + 1.5;
      if (camDist < minDist) {
        scratch.camPos.copy(PLANET_CENTER).addScaledVector(scratch.camRadial, minDist);
      }
    }

    camera.up.copy(scratch.up);
    camera.position.copy(scratch.camPos);
    camera.lookAt(scratch.head);

    const nextState = getMotionState(
      speed,
      groundedRef.current,
      radialVelRef.current,
      input.sprint,
    );
    if (nextState !== motionState) setMotionState(nextState);

    onUpdate({
      position: pos,
      speed,
      altitude: r - radius,
      isGrounded: groundedRef.current,
      state: nextState,
      isPointerLocked: pointerLockedRef.current,
    });
  });

  if (!terrain.ready) return null;

  return (
    <group ref={groupRef}>
      <Suspense fallback={null}>
        <CharacterModel
          turnRateRef={turnRateRef}
          speedRef={speedRef}
          motionState={motionState}
          inputRef={inputRef}
        />
      </Suspense>
    </group>
  );
}

function CharacterHud({ snapshot }: { snapshot: SphereCharacterSnapshot | null }) {
  return (
    <>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80">
        <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </div>
      <div className="pointer-events-none absolute left-2 top-14 z-10 rounded-md border border-white/10 bg-black/55 px-3 py-2 text-xs text-white backdrop-blur-sm md:left-4 md:top-16">
        <div className="font-medium">Spherical Character Controller</div>
        <div>state: {snapshot?.state ?? "booting"}</div>
        <div>grounded: {snapshot?.isGrounded ? "yes" : "no"}</div>
        <div>pointer lock: {snapshot?.isPointerLocked ? "locked" : "click canvas"}</div>
        <div>speed: {snapshot ? snapshot.speed.toFixed(2) : "0.00"}</div>
        <div>altitude: {snapshot ? snapshot.altitude.toFixed(1) : "0.0"}</div>
        <div className="mt-1 text-white/70">WASD move, Shift sprint, Space jump</div>
        <div className="text-white/70">Click canvas to look, Esc to release</div>
      </div>
    </>
  );
}

function SpherePlanetCharacterSceneImpl({
  store,
  onUpdate,
}: {
  store: LevaStore;
  onUpdate: (snapshot: SphereCharacterSnapshot) => void;
}) {
  const controls = useControls(
    "Sphere Planet Character",
    {
      radius: {
        value: 5000,
        min: 1000,
        max: 8000,
        step: 100,
        label: "radius",
      },
      maxLevel: {
        value: 10,
        min: 6,
        max: 20,
        step: 1,
        label: "max level",
      },
      maxNodes: {
        value: 8192,
        min: 256,
        max: 32768,
        step: 256,
        label: "max nodes",
      },
      elevationScale: {
        value: 320,
        min: 0,
        max: 800,
        step: 5,
        label: "elevation scale",
      },
      skirtScale: {
        value: 4,
        min: 0,
        max: 200,
        step: 1,
        label: "skirt scale",
      },
      noiseFrequency: {
        value: 9,
        min: 0.2,
        max: 40,
        step: 0.1,
        label: "noise frequency",
      },
      ruggedness: {
        value: 0.85,
        min: 0,
        max: 1.5,
        step: 0.05,
        label: "ruggedness",
      },
      seaLevel: {
        value: 0.32,
        min: 0,
        max: 1,
        step: 0.01,
        label: "sea level",
      },
      walkSpeed: {
        value: 16,
        min: 2,
        max: 60,
        step: 1,
        label: "walk speed",
      },
      sprintSpeed: {
        value: 38,
        min: 4,
        max: 120,
        step: 1,
        label: "sprint speed",
      },
      gravity: {
        value: 45,
        min: 5,
        max: 200,
        step: 1,
        label: "gravity",
      },
      jumpSpeed: {
        value: 22,
        min: 2,
        max: 80,
        step: 1,
        label: "jump speed",
      },
      cameraDistance: {
        value: 7,
        min: 2,
        max: 24,
        step: 0.5,
        label: "camera distance",
      },
      sensitivity: {
        value: 0.18,
        min: 0.02,
        max: 0.6,
        step: 0.01,
        label: "look sensitivity",
      },
      wireframe: {
        value: false,
      },
    },
    { store },
  );

  // The character lives at the north pole, dropped from just above the peaks.
  const positionRef = useRef(new Vector3(0, controls.radius + controls.elevationScale + 20, 0));

  const surface = useMemo(
    () =>
      createCubeSphereSurface({
        radius: controls.radius,
        maxHeight: controls.elevationScale,
      }),
    [controls.radius, controls.elevationScale],
  );

  const elevation = useMemo(
    () =>
      createPlanetElevation({
        noiseFrequency: controls.noiseFrequency,
        seaLevel: controls.seaLevel,
        ruggedness: controls.ruggedness,
      }),
    [controls.noiseFrequency, controls.seaLevel, controls.ruggedness],
  );

  const colorNode = useMemo(
    () =>
      createPlanetColorNode({
        radius: controls.radius,
        elevationScale: controls.elevationScale,
      }),
    [controls.radius, controls.elevationScale],
  );

  // Keep terrain LOD detail centered on the character rather than the camera.
  const getCameraOrigin = useCallback(() => {
    const p = positionRef.current;
    return { x: p.x, y: p.y, z: p.z };
  }, []);

  const terrain = useTerrain({
    surface,
    radius: controls.radius,
    maxLevel: controls.maxLevel,
    maxNodes: controls.maxNodes,
    skirtScale: controls.skirtScale,
    elevationScale: controls.elevationScale,
    elevation,
    getCameraOrigin,
  });

  return (
    <>
      <Terrain terrain={terrain} maxNodes={controls.maxNodes} frustumCulled={false}>
        {({ positionNode }) => (
          <meshStandardNodeMaterial
            positionNode={positionNode}
            colorNode={controls.wireframe ? undefined : colorNode}
            color={controls.wireframe ? "white" : undefined}
            wireframe={controls.wireframe}
            metalness={0.05}
            roughness={0.95}
          />
        )}
      </Terrain>

      <SphereCharacter
        terrain={terrain}
        radius={controls.radius}
        elevationScale={controls.elevationScale}
        walkSpeed={controls.walkSpeed}
        sprintSpeed={controls.sprintSpeed}
        gravity={controls.gravity}
        jumpSpeed={controls.jumpSpeed}
        sensitivity={controls.sensitivity}
        cameraDistance={controls.cameraDistance}
        positionRef={positionRef}
        onUpdate={onUpdate}
      />
    </>
  );
}

export default function SpherePlanetCharacterScene() {
  const store = useCreateStore();
  const [snapshot, setSnapshot] = useState<SphereCharacterSnapshot | null>(null);

  return (
    <ExamplesCanvas store={store}>
      <CharacterHud snapshot={snapshot} />
      <div className="pointer-events-none absolute z-10 bottom-2 left-2 right-2 md:left-auto md:bottom-4 md:right-4 md:max-w-xs flex flex-col gap-1.5">
        <FpsDebug />
      </div>
      <Canvas
        className="touch-none relative left-0 top-0 h-full w-full"
        gl={async (props) => {
          props.alpha = true;
          props.antialias = true;
          const renderer = new THREE.WebGPURenderer(props as WebGPURendererParameters);
          renderer.logarithmicDepthBuffer = true;
          await renderer.init();
          return renderer;
        }}
        camera={{
          near: 0.5,
          far: 200000,
          fov: 65,
          position: [0, 5200, 60],
        }}
        dpr={[1, 1.5]}
        performance={{ min: 0.5 }}
      >
        <color attach="background" args={["#0b1b2b"]} />
        <Environment preset="sunset" />
        <ambientLight intensity={0.35} />
        <directionalLight intensity={1.6} position={[1, 0.6, 0.8]} />
        <Suspense fallback={null}>
          <SpherePlanetCharacterSceneImpl store={store} onUpdate={setSnapshot} />
        </Suspense>
      </Canvas>
    </ExamplesCanvas>
  );
}
