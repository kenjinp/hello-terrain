import { useEffect, useState, type RefObject } from "react";
import type { TerrainConfig, WorldRenderer } from "@hello-terrain/three";

export const useThreeWorld = (
  canvasRef: RefObject<HTMLCanvasElement>,
  config?: Partial<TerrainConfig>
) => {
  const [world, _setWorld] = useState<WorldRenderer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      // TODO: Implement world creation with canvas
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsLoading(false);
    }
  }, [canvasRef, config]);

  return { world, isLoading, error };
};
