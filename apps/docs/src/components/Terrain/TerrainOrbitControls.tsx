import type { TerrainMesh } from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentProps, forwardRef, useRef } from "react";
import type { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export interface TerrainOrbitControlsProps
  extends Omit<ComponentProps<typeof OrbitControls>, "ref"> {
  /**
   * Reference to the TerrainMesh to query height from.
   * If not provided or terrain has no valid height data, controls work as normal OrbitControls.
   */
  terrainMesh?: TerrainMesh | null;
  /**
   * Minimum height above the terrain surface (in world units).
   * The camera will be kept at least this far above the terrain.
   * @default 5
   */
  minHeightAboveTerrain?: number;
  /**
   * How quickly the camera adjusts to maintain minimum height.
   * Value between 0 and 1 - higher values mean faster adjustment.
   * @default 0.3
   */
  heightAdjustmentSpeed?: number;
}

/**
 * OrbitControls that prevent the camera from going below the terrain surface.
 * Queries the TerrainMesh for height at the camera's XZ position and adjusts
 * the camera Y position to stay above the terrain.
 */
export const TerrainOrbitControls = forwardRef<
  OrbitControlsImpl,
  TerrainOrbitControlsProps
>(
  (
    {
      terrainMesh,
      minHeightAboveTerrain = 5,
      heightAdjustmentSpeed = 0.3,
      ...orbitControlsProps
    },
    ref
  ) => {
    const { camera } = useThree();
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const lastValidTerrainHeight = useRef<number>(0);

    // Combine forwarded ref with internal ref
    const setRefs = (instance: OrbitControlsImpl | null) => {
      controlsRef.current = instance;
      if (typeof ref === "function") {
        ref(instance);
      } else if (ref) {
        ref.current = instance;
      }
    };

    useFrame(() => {
      const controls = controlsRef.current;
      if (!controls) return;

      // Query terrain height at camera's XZ position
      let terrainHeight = lastValidTerrainHeight.current;

      if (terrainMesh?.hasValidHeightData) {
        const queriedHeight = terrainMesh.queryHeightAtPosition(
          camera.position as Vector3
        );
        if (queriedHeight !== null) {
          terrainHeight = queriedHeight;
          lastValidTerrainHeight.current = terrainHeight;
        }
      }

      const minCameraY = terrainHeight + minHeightAboveTerrain;

      // If camera is below minimum height, push it up
      if (camera.position.y < minCameraY) {
        // Lerp for smooth adjustment, but ensure we never go below
        const targetY = Math.max(
          camera.position.y +
            (minCameraY - camera.position.y) * heightAdjustmentSpeed,
          minCameraY - minHeightAboveTerrain * 0.5 // Allow slight dip during lerp
        );

        // Hard clamp to ensure we're always above terrain
        camera.position.y = Math.max(targetY, minCameraY);

        // Update the controls to recognize the new camera position
        controls.update();
      }
    });

    return <OrbitControls ref={setRefs} {...orbitControlsProps} />;
  }
);

TerrainOrbitControls.displayName = "TerrainOrbitControls";
