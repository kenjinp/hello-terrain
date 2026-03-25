"use client";

import type { TerrainRuntime } from "@hello-terrain/react";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { MathUtils, Ray, Vector3 } from "three";

type UseThirdPersonCameraParams = {
  targetPositionRef: MutableRefObject<Vector3>;
  terrainRuntime?: TerrainRuntime;
  viewVectorRef?: MutableRefObject<Vector3>;
  targetHeight?: number;
  radius?: number;
  minRadius?: number;
  maxRadius?: number;
  sensitivityX?: number;
  sensitivityY?: number;
  enabled?: boolean;
  zoomEnabled?: boolean;
};

export function useThirdPersonCamera({
  targetPositionRef,
  terrainRuntime,
  viewVectorRef: providedViewVectorRef,
  targetHeight = 1.2,
  radius = 4.8,
  minRadius = 1.75,
  maxRadius = 8,
  sensitivityX = 0.16,
  sensitivityY = 0.12,
  enabled = true,
  zoomEnabled = false,
}: UseThirdPersonCameraParams) {
  const { camera, gl } = useThree();

  const thetaRef = useRef(205);
  const phiRef = useRef(-12);
  const currentRadiusRef = useRef(radius);
  const desiredRadiusRef = useRef(radius);
  const internalViewVectorRef = useRef(new Vector3(0, 0, 1));
  const viewVectorRef = providedViewVectorRef ?? internalViewVectorRef;
  const smoothedTargetRef = useRef(new Vector3());
  const smoothedCameraPositionRef = useRef(new Vector3());
  const smoothedFloorYRef = useRef(0);
  const hasSmoothedStateRef = useRef(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  const scratch = useMemo(
    () => ({
      target: new Vector3(),
      desiredCameraPosition: new Vector3(),
      resolvedCameraPosition: new Vector3(),
      cameraDirection: new Vector3(),
      cameraCollisionRay: new Ray(new Vector3(), new Vector3(0, 0, 1)),
    }),
    [],
  );

  useEffect(() => {
    const clampedRadius = MathUtils.clamp(radius, minRadius, maxRadius);
    desiredRadiusRef.current = clampedRadius;
    currentRadiusRef.current = MathUtils.clamp(
      currentRadiusRef.current,
      minRadius,
      maxRadius,
    );
  }, [maxRadius, minRadius, radius]);

  useEffect(() => {
    if (!enabled) return;

    const element = gl.domElement;

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== element) return;
      thetaRef.current -= event.movementX * sensitivityX;
      phiRef.current = MathUtils.clamp(
        phiRef.current + event.movementY * sensitivityY,
        -85,
        85,
      );
    };

    const onPointerLockChange = () => {
      setIsPointerLocked(document.pointerLockElement === element);
    };

    const onCanvasClick = () => {
      if (document.pointerLockElement !== element) {
        void element.requestPointerLock();
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    element.addEventListener("click", onCanvasClick);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      element.removeEventListener("click", onCanvasClick);
    };
  }, [enabled, gl, sensitivityX, sensitivityY]);

  useEffect(() => {
    if (!enabled) return;

    const element = gl.domElement;

    const onWheel = (event: WheelEvent) => {
      if (!zoomEnabled) return;
      event.preventDefault();
      desiredRadiusRef.current = MathUtils.clamp(
        desiredRadiusRef.current + event.deltaY * 0.01,
        minRadius,
        maxRadius,
      );
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [enabled, gl, maxRadius, minRadius, zoomEnabled]);

  useFrame((_state, dt) => {
    if (!enabled) return;

    scratch.target.copy(targetPositionRef.current);
    scratch.target.y += targetHeight;

    if (!hasSmoothedStateRef.current) {
      smoothedTargetRef.current.copy(scratch.target);
      smoothedCameraPositionRef.current.copy(camera.position);
      smoothedFloorYRef.current = camera.position.y;
      hasSmoothedStateRef.current = true;
    }

    const targetHorizontalBlend = 1 - Math.exp(-10 * Math.min(dt, 1 / 20));
    const targetVerticalBlend = 1 - Math.exp(-5 * Math.min(dt, 1 / 20));
    smoothedTargetRef.current.x = MathUtils.lerp(
      smoothedTargetRef.current.x,
      scratch.target.x,
      targetHorizontalBlend,
    );
    smoothedTargetRef.current.z = MathUtils.lerp(
      smoothedTargetRef.current.z,
      scratch.target.z,
      targetHorizontalBlend,
    );
    smoothedTargetRef.current.y = MathUtils.lerp(
      smoothedTargetRef.current.y,
      scratch.target.y,
      targetVerticalBlend,
    );

    const radiusBlend = 1 - Math.exp(-12 * Math.min(dt, 1 / 20));
    currentRadiusRef.current = MathUtils.lerp(
      currentRadiusRef.current,
      desiredRadiusRef.current,
      radiusBlend,
    );

    const thetaRad = MathUtils.degToRad(thetaRef.current);
    const phiRad = MathUtils.degToRad(phiRef.current);
    const planarRadius = Math.cos(phiRad) * currentRadiusRef.current;

    scratch.desiredCameraPosition.set(
      smoothedTargetRef.current.x + Math.sin(thetaRad) * planarRadius,
      smoothedTargetRef.current.y + Math.sin(phiRad) * currentRadiusRef.current,
      smoothedTargetRef.current.z + Math.cos(thetaRad) * planarRadius,
    );

    scratch.resolvedCameraPosition.copy(scratch.desiredCameraPosition);

    scratch.cameraDirection
      .copy(scratch.desiredCameraPosition)
      .sub(smoothedTargetRef.current);
    const desiredDistance = scratch.cameraDirection.length();
    if (desiredDistance > 1e-6) {
      scratch.cameraDirection.divideScalar(desiredDistance);

      const terrainRaycast = terrainRuntime?.raycast;
      if (terrainRaycast) {
        scratch.cameraCollisionRay.origin.copy(smoothedTargetRef.current);
        scratch.cameraCollisionRay.direction.copy(scratch.cameraDirection);
        const hit = terrainRaycast.pick(scratch.cameraCollisionRay, {
          maxSteps: 96,
          refinementSteps: 6,
          maxDistance: desiredDistance,
        });
        if (hit && hit.distance < desiredDistance) {
          scratch.resolvedCameraPosition
            .copy(hit.position)
            .addScaledVector(scratch.cameraDirection, -0.45)
            .addScaledVector(hit.normal, 0.2);
        }
      }
    }

    const terrainQuery = terrainRuntime?.query;
    if (terrainQuery) {
      const sample = terrainQuery.sampleTerrain(
        scratch.resolvedCameraPosition.x,
        scratch.resolvedCameraPosition.z,
      );
      if (sample.valid) {
        const desiredFloorY = sample.elevation + 0.35;
        const floorDelta = desiredFloorY - smoothedFloorYRef.current;
        const floorBlend = 1 - Math.exp(-(floorDelta > 0 ? 12 : 4) * Math.min(dt, 1 / 20));
        smoothedFloorYRef.current = MathUtils.lerp(
          smoothedFloorYRef.current,
          desiredFloorY,
          floorBlend,
        );
        scratch.resolvedCameraPosition.y = Math.max(
          scratch.resolvedCameraPosition.y,
          smoothedFloorYRef.current,
        );
      }
    }

    const followHorizontalBlend = 1 - Math.exp(-8 * Math.min(dt, 1 / 20));
    const verticalDelta =
      scratch.resolvedCameraPosition.y - smoothedCameraPositionRef.current.y;
    const followVerticalBlend =
      1 - Math.exp(-(verticalDelta > 0 ? 10 : 4) * Math.min(dt, 1 / 20));
    smoothedCameraPositionRef.current.x = MathUtils.lerp(
      smoothedCameraPositionRef.current.x,
      scratch.resolvedCameraPosition.x,
      followHorizontalBlend,
    );
    smoothedCameraPositionRef.current.z = MathUtils.lerp(
      smoothedCameraPositionRef.current.z,
      scratch.resolvedCameraPosition.z,
      followHorizontalBlend,
    );
    smoothedCameraPositionRef.current.y = MathUtils.lerp(
      smoothedCameraPositionRef.current.y,
      scratch.resolvedCameraPosition.y,
      followVerticalBlend,
    );
    camera.position.copy(smoothedCameraPositionRef.current);
    camera.lookAt(smoothedTargetRef.current);

    viewVectorRef.current
      .copy(smoothedTargetRef.current)
      .sub(camera.position)
      .setY(0);
    if (viewVectorRef.current.lengthSq() > 1e-6) {
      viewVectorRef.current.normalize();
    } else {
      viewVectorRef.current.set(0, 0, 1);
    }
  });

  return {
    viewVectorRef,
    isPointerLocked,
  };
}
