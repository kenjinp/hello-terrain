import { useFrame, useThree } from '@react-three/fiber';
import type { FC } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import type { Quadtree } from './lib/HelloTerrain/Quadtree';

export const DebugSpheres: FC<{
  quadtree?: Quadtree;
}> = ({ quadtree }) => {
  const debugSpheresRef = useRef<THREE.Mesh[]>([]);

  const { scene } = useThree();

  useEffect(() => {
    return () => {
      for (const sphere of debugSpheresRef.current) {
        scene.remove(sphere);
      }
      debugSpheresRef.current = [];
    };
  }, [scene]);

  const createDebugSpheres = useCallback(
    (quadtree: Quadtree) => {
      for (const sphere of debugSpheresRef.current) {
        scene.remove(sphere);
      }
      debugSpheresRef.current = [];

      const leafNodes = quadtree.getLeafNodes();
      const config = quadtree.getConfig();

      for (let index = 0; index < leafNodes.length; index++) {
        const node = leafNodes[index];
        const tileSize = config.rootSize / 2 ** node.level;
        const worldX =
          config.origin.x + ((node.x + 0.5) * tileSize - 0.5 * config.rootSize);
        const worldZ =
          config.origin.z + ((node.y + 0.5) * tileSize - 0.5 * config.rootSize);

        // Create sphere geometry
        const sphereGeometry = new THREE.SphereGeometry(tileSize * 0.1, 8, 6); // Small sphere relative to tile size
        const sphereMaterial = new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(index * 0.1, 1, 0.5), // Different color for each sphere
          transparent: true,
          opacity: 0.7,
        });

        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere.position.set(worldX, 0, worldZ);

        scene.add(sphere);
        debugSpheresRef.current.push(sphere);
      }
    },
    [scene],
  );

  useFrame(() => {
    if (quadtree) {
      createDebugSpheres(quadtree);
    }
  });

  return null;
};
