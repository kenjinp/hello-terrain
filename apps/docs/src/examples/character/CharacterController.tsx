"use client";

import { useExamplesCanvas } from "@/components/ExamplesCanvas";
import { useTerrainContext } from "@hello-terrain/react";
import { useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import { Vector3 } from "three";

import { CharacterModel } from "./CharacterModel";
import {
  useCharacterController,
  type CharacterMotionState,
} from "./useCharacterController";
import { useKeyboardInput } from "./useKeyboardInput";
import { useThirdPersonCamera } from "./useThirdPersonCamera";

export type CharacterControllerSnapshot = {
  position: Vector3;
  velocity: Vector3;
  isGrounded: boolean;
  state: CharacterMotionState;
  isPointerLocked: boolean;
};

type CharacterControllerProps = {
  initialPosition?: [number, number, number];
  cameraRadius?: number;
  cameraMinRadius?: number;
  cameraSensitivityX?: number;
  cameraSensitivityY?: number;
  onUpdate?: (snapshot: CharacterControllerSnapshot) => void;
};

export function CharacterController({
  initialPosition = [0, 12, 0],
  cameraRadius = 4.8,
  cameraMinRadius = 1.75,
  cameraSensitivityX = 0.16,
  cameraSensitivityY = 0.12,
  onUpdate,
}: CharacterControllerProps) {
  const terrain = useTerrainContext();
  const { isFullscreen } = useExamplesCanvas();
  const inputRef = useKeyboardInput(true);
  const viewVectorRef = useRef(new Vector3(0, 0, 1));
  const latestStateRef = useRef<CharacterMotionState>("falling");
  const latestGroundedRef = useRef(false);
  const speedRef = useRef(0);

  const {
    groupRef,
    positionRef,
    velocityRef,
    turnRateRef,
    state,
    isGroundedRef,
  } = useCharacterController({
    inputRef,
    viewVectorRef,
    terrainRuntime: terrain.runtime,
    enabled: terrain.ready,
    initialPosition,
    onUpdate: (snapshot) => {
      latestStateRef.current = snapshot.state;
      latestGroundedRef.current = snapshot.isGrounded;
    },
  });

  const { isPointerLocked } = useThirdPersonCamera({
    targetPositionRef: positionRef,
    terrainRuntime: terrain.runtime,
    viewVectorRef,
    targetHeight: 1.15,
    radius: cameraRadius,
    minRadius: cameraMinRadius,
    maxRadius: cameraRadius,
    sensitivityX: cameraSensitivityX,
    sensitivityY: cameraSensitivityY,
    enabled: terrain.ready,
    zoomEnabled: isFullscreen && terrain.ready,
  });

  useFrame(() => {
    if (!terrain.ready) return;
    speedRef.current = Math.hypot(velocityRef.current.x, velocityRef.current.z);
    onUpdate?.({
      position: positionRef.current,
      velocity: velocityRef.current,
      isGrounded: isGroundedRef.current ?? latestGroundedRef.current,
      state: state ?? latestStateRef.current,
      isPointerLocked,
    });
  });

  if (!terrain.ready) return null;

  return (
    <group ref={groupRef}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.56, 0]}
        receiveShadow
      >
        <circleGeometry args={[0.35, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} />
      </mesh>
      <Suspense fallback={null}>
        <CharacterModel
          turnRateRef={turnRateRef}
          speedRef={speedRef}
          motionState={state}
          inputRef={inputRef}
        />
      </Suspense>
    </group>
  );
}
