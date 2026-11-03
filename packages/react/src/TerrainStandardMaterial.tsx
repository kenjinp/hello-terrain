import { applyTerrainTextureNodes } from "@hello-terrain/three";
import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { useTerrainContext } from "./TerrainContext";

export type TerrainStandardMaterialProps = Omit<ThreeElements["meshStandardMaterial"], "args" | "children">;

/** Binds the current terrain nodes. Owns its material, never the caller's texture set. */
export function TerrainStandardMaterial(props: TerrainStandardMaterialProps) {
  const { positionNode, texture } = useTerrainContext();
  const material = useMemo(() => {
    const next = new MeshStandardNodeMaterial();
    next.positionNode = positionNode;
    if (texture) applyTerrainTextureNodes(next, texture);
    return next;
  }, [positionNode, texture]);
  useEffect(() => () => material.dispose(), [material]);
  return <primitive object={material} attach="material" {...props} />;
}
