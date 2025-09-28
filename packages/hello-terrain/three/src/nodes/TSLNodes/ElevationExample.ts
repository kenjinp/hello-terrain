import { vec2_fbm } from "../../fmb";
import { ElevationFn } from "./ElevationFn";

// Example of how to use the ElevationFn with automatic typing
export const exampleElevationFunction = ElevationFn(
  ({ worldUv, heightmapScale }) => {
    // Simple FBM-based elevation
    const fbm = vec2_fbm(
      worldUv,
      8, // iterations
      1.0, // amplitude
      2.4, // frequency
      0.4, // lacunarity
      0.85 // persistence
    );

    // Scale the height by the heightmapScale parameter
    return fbm.mul(heightmapScale);
  }
);

// Example with more complex elevation logic
export const complexElevationFunction = ElevationFn(
  ({ worldUv, heightmapScale, level }) => {
    // Base FBM noise
    const baseNoise = vec2_fbm(worldUv, 4, 1.0, 2.0, 0.5, 0.8);

    // Add detail based on level (higher levels = more detail)
    const detailNoise = level
      ? vec2_fbm(worldUv.mul(level), 2, 0.5, 4.0, 0.5, 0.8)
      : baseNoise;

    // Combine base and detail
    const combinedNoise = baseNoise.add(detailNoise);

    // Apply heightmap scaling
    return combinedNoise.mul(heightmapScale);
  }
);

// Example showing how to use in HelloTerrain
export const terrainElevationExample = {
  // This can be passed directly to HelloTerrain's elevationNode prop
  elevationNode: ElevationFn(({ worldUv, heightmapScale }) => {
    // Your elevation logic here
    const height = vec2_fbm(worldUv, 6, 1.0, 2.4, 0.4, 0.85);
    return height.mul(heightmapScale);
  }),
};
