import { FlyControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { type FC, type PropsWithChildren, type RefObject, useRef } from 'react';
import { MathUtils } from 'three';
import type { FlyControls as FlyControlsImpl } from 'three-stdlib';

const remap = (
  value: number,
  start1: number,
  end1: number,
  start2: number,
  end2: number,
) => {
  return start2 + (end2 - start2) * ((value - start1) / (end1 - start1));
};

export class LerpDuration {
  public lerpStart = Date.now();
  public lerpProgress = 0;
  constructor(public lerpDuration = 5_000) {}

  lerp(x: number, y: number) {
    const now = Date.now();
    const delta = now - this.lerpStart;
    this.lerpProgress = Math.min(delta, this.lerpDuration);
    const alpha = Math.min(
      1,
      remap(this.lerpProgress, 0, this.lerpDuration, 0, 1),
    );
    return MathUtils.lerp(x, y, alpha);
  }

  reset() {
    this.lerpStart = Date.now();
    this.lerpProgress = 0;
  }
}

export const FlyCamera: FC<
  PropsWithChildren<{
    height: RefObject<number>;
    minSpeed?: number;
    maxSpeed?: number;
    rollSpeed?: number;
    minAltitude?: number;
  }>
> = ({
  height,
  minSpeed = 2,
  maxSpeed = 1_000_000,
  rollSpeed = 0.3,
  minAltitude = 2,
}) => {
  const camera = useThree((s) => s.camera);
  const targetSpeedRef = useRef(0);
  const flyControlsRef = useRef<FlyControlsImpl>(null);
  const lerpDurationRef = useRef(new LerpDuration(500));

  useFrame((_s) => {
    if (!height.current) return;
    const altitude = camera.position.y - height.current;
    const targetSpeed = targetSpeedRef.current;
    const lerpDuration = lerpDurationRef.current;
    const flyControls = flyControlsRef.current;
    if (!flyControls) return;
    const lerpy = lerpDuration;

    if (camera.position.y < height.current + minAltitude) {
      camera.position.y = height.current + minAltitude;
    }

    // apply speed to fly camera controls based on distance to ground
    targetSpeedRef.current = MathUtils.clamp(
      Math.abs(altitude),
      minSpeed,
      maxSpeed,
    );

    const currentMovement = flyControls.movementSpeed || 0;

    const lerpedMovementSpeed = lerpy.lerp(currentMovement, targetSpeed);
    flyControls.movementSpeed = lerpedMovementSpeed;

    flyControls.object.position.copy(camera.position);

    const speedElement = document.getElementById('cameraSpeed');
    if (speedElement) {
      speedElement.textContent = `${lerpedMovementSpeed.toFixed(2)} units/second`;
    }
  });

  return (
    <FlyControls
      ref={flyControlsRef}
      dragToLook
      movementSpeed={minSpeed}
      rollSpeed={rollSpeed}
    />
  );
};
