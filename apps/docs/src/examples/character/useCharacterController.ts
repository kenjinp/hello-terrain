"use client";

import type { TerrainRuntime } from "@hello-terrain/react";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState, type MutableRefObject } from "react";
import { Group, Ray, Vector3 } from "three";

import type { CharacterInputState } from "./useKeyboardInput";

const CHARACTER_RIDE_HEIGHT = 0.57;
const FOOT_CLEARANCE = 0.03;

export type CharacterMotionState =
  | "idle"
  | "walking"
  | "sprinting"
  | "jumping"
  | "falling";

type UseCharacterControllerParams = {
  inputRef: MutableRefObject<CharacterInputState>;
  viewVectorRef: MutableRefObject<Vector3>;
  terrainRuntime: TerrainRuntime;
  enabled?: boolean;
  initialPosition?: [number, number, number];
  onUpdate?: (snapshot: {
    position: Vector3;
    velocity: Vector3;
    isGrounded: boolean;
    state: CharacterMotionState;
  }) => void;
};

function applyVectorMatrixXZ(a: Vector3, b: Vector3) {
  return new Vector3(a.x * b.z + a.z * b.x, b.y, a.z * b.z - a.x * b.x);
}

function dampAngle(current: number, target: number, lambda: number, dt: number) {
  let delta = target - current;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function getMotionState(
  horizontalSpeed: number,
  isGrounded: boolean,
  verticalVelocity: number,
  sprint: boolean,
): CharacterMotionState {
  if (!isGrounded) return verticalVelocity > 0.05 ? "jumping" : "falling";
  if (horizontalSpeed < 0.25) return "idle";
  return sprint ? "sprinting" : "walking";
}

export function useCharacterController({
  inputRef,
  viewVectorRef,
  terrainRuntime,
  enabled = true,
  initialPosition = [0, 12, 0],
  onUpdate,
}: UseCharacterControllerParams) {
  const groupRef = useRef<Group>(null);
  const positionRef = useRef(new Vector3(...initialPosition));
  const velocityRef = useRef(new Vector3());
  const isGroundedRef = useRef(false);
  const yawRef = useRef(0);
  const turnRateRef = useRef(0);
  const previousJumpRef = useRef(false);
  const [state, setState] = useState<CharacterMotionState>("falling");

  const scratch = useMemo(
    () => ({
      localInput: new Vector3(),
      flatView: new Vector3(),
      worldMoveDir: new Vector3(),
      targetVelocity: new Vector3(),
      prevPosition: new Vector3(),
      rayOrigin: new Vector3(),
      downRay: new Ray(new Vector3(), new Vector3(0, -1, 0)),
    }),
    [],
  );

  useFrame((_frame, dt) => {
    if (!enabled) return;
    const delta = Math.min(dt, 1 / 20);
    const input = inputRef.current;
    const query = terrainRuntime.query;
    const terrainRaycast = terrainRuntime.raycast;

    scratch.prevPosition.copy(positionRef.current);

    scratch.localInput.set(
      (input.left ? 1 : 0) + (input.right ? -1 : 0),
      0,
      (input.forward ? 1 : 0) + (input.backward ? -1 : 0),
    );
    if (scratch.localInput.lengthSq() > 1) {
      scratch.localInput.normalize();
    }

    const wantsMove = scratch.localInput.lengthSq() > 0.0001;
    const targetSpeed = wantsMove ? (input.sprint ? 8.2 : 5.4) : 0;

    scratch.flatView.copy(viewVectorRef.current).setY(0);
    if (scratch.flatView.lengthSq() < 1e-6) {
      scratch.flatView.set(0, 0, 1);
    } else {
      scratch.flatView.normalize();
    }

    scratch.worldMoveDir.copy(
      applyVectorMatrixXZ(scratch.flatView, scratch.localInput),
    );
    if (scratch.worldMoveDir.lengthSq() > 1e-6) {
      scratch.worldMoveDir.normalize();
    }

    scratch.targetVelocity
      .copy(scratch.worldMoveDir)
      .multiplyScalar(targetSpeed);

    const horizontalBlend = 1 - Math.exp(-10 * delta);
    velocityRef.current.x +=
      (scratch.targetVelocity.x - velocityRef.current.x) * horizontalBlend;
    velocityRef.current.z +=
      (scratch.targetVelocity.z - velocityRef.current.z) * horizontalBlend;

    const jumpPressed = input.jump;
    const jumpJustPressed = jumpPressed && !previousJumpRef.current;
    previousJumpRef.current = jumpPressed;

    if (jumpJustPressed && isGroundedRef.current) {
      velocityRef.current.y = 7.1;
      isGroundedRef.current = false;
    } else {
      velocityRef.current.y -= 18 * delta;
    }

    positionRef.current.addScaledVector(velocityRef.current, delta);

    let sampledGroundY: number | null = null;
    if (query) {
      const sample = query.sampleTerrain(positionRef.current.x, positionRef.current.z);
      if (sample.valid) sampledGroundY = sample.elevation;
    }

    if (terrainRaycast) {
      scratch.rayOrigin.set(
        positionRef.current.x,
        positionRef.current.y + 6,
        positionRef.current.z,
      );
      scratch.downRay.origin.copy(scratch.rayOrigin);
      const rayHit = terrainRaycast.pick(scratch.downRay, {
        maxSteps: 96,
        refinementSteps: 6,
        maxDistance: 32,
      });
      if (rayHit) sampledGroundY = rayHit.position.y;
    }

    if (sampledGroundY != null) {
      const snappedY = sampledGroundY + CHARACTER_RIDE_HEIGHT + FOOT_CLEARANCE;
      if (positionRef.current.y <= snappedY && velocityRef.current.y <= 0) {
        positionRef.current.y = snappedY;
        velocityRef.current.y = 0;
        isGroundedRef.current = true;
      } else if (positionRef.current.y > snappedY + 0.2) {
        isGroundedRef.current = false;
      }
    }

    const horizontalSpeed = Math.hypot(velocityRef.current.x, velocityRef.current.z);
    if (horizontalSpeed > 0.05) {
      const targetYaw = Math.atan2(velocityRef.current.x, velocityRef.current.z);
      const prevYaw = yawRef.current;
      yawRef.current = dampAngle(yawRef.current, targetYaw, 12, delta);
      const yawDelta = Math.atan2(
        Math.sin(yawRef.current - prevYaw),
        Math.cos(yawRef.current - prevYaw),
      );
      turnRateRef.current = yawDelta / Math.max(delta, 1e-4);
    } else {
      turnRateRef.current *= Math.exp(-8 * delta);
    }

    const nextState = getMotionState(
      horizontalSpeed,
      isGroundedRef.current,
      velocityRef.current.y,
      input.sprint,
    );
    if (nextState !== state) setState(nextState);

    if (groupRef.current) {
      groupRef.current.position.copy(positionRef.current);
      groupRef.current.rotation.y = yawRef.current;
    }

    onUpdate?.({
      position: positionRef.current,
      velocity: velocityRef.current,
      isGrounded: isGroundedRef.current,
      state: nextState,
    });
  });

  return {
    groupRef,
    positionRef,
    velocityRef,
    yawRef,
    turnRateRef,
    isGroundedRef,
    state,
  };
}
