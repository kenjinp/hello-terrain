"use client";

import type { TerrainQuery, TerrainRaycast } from "@hello-terrain/three";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { MathUtils, Ray, Vector3 } from "three";

type UseThirdPersonCameraParams = {
  targetPositionRef: MutableRefObject<Vector3>;
  terrainQueryRef?: MutableRefObject<TerrainQuery | null>;
  terrainRaycastRef?: MutableRefObject<TerrainRaycast | null>;
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
  terrainQueryRef,
  terrainRaycastRef,
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
      scratch.target.x + Math.sin(thetaRad) * planarRadius,
      scratch.target.y + Math.sin(phiRad) * currentRadiusRef.current,
      scratch.target.z + Math.cos(thetaRad) * planarRadius,
    );

    scratch.resolvedCameraPosition.copy(scratch.desiredCameraPosition);

    scratch.cameraDirection
      .copy(scratch.desiredCameraPosition)
      .sub(scratch.target);
    const desiredDistance = scratch.cameraDirection.length();
    if (desiredDistance > 1e-6) {
      scratch.cameraDirection.divideScalar(desiredDistance);

      const terrainRaycast = terrainRaycastRef?.current;
      if (terrainRaycast) {
        scratch.cameraCollisionRay.origin.copy(scratch.target);
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

    const terrainQuery = terrainQueryRef?.current;
    if (terrainQuery) {
      const sample = terrainQuery.sampleTerrain(
        scratch.resolvedCameraPosition.x,
        scratch.resolvedCameraPosition.z,
      );
      if (sample.valid) {
        scratch.resolvedCameraPosition.y = Math.max(
          scratch.resolvedCameraPosition.y,
          sample.elevation + 0.35,
        );
      }
    }

    const followBlend = 1 - Math.exp(-14 * Math.min(dt, 1 / 20));
    camera.position.lerp(scratch.resolvedCameraPosition, followBlend);
    camera.lookAt(scratch.target);

    viewVectorRef.current.copy(scratch.target).sub(camera.position).setY(0);
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
