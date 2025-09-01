import { ElevationFn } from "./Elevation";

// Test that the ElevationFn works correctly
export const testElevationFunction = ElevationFn((params) => {
  // This should compile without errors and have proper typing
  const { heightmapScale } = params;

  // Test optional parameters
  if (params.level) {
    // level is available
  }

  if (params.tileSize) {
    // tileSize is available
  }

  // Return a simple value (this would be your actual elevation calculation)
  return heightmapScale;
});

// Test with destructured parameters
export const testDestructuredElevationFunction = ElevationFn(({ heightmapScale }) => {
  // This should also compile without errors and have proper typing
  return heightmapScale;
});

// Test that the callback type is correct
export const testCallbackType = ElevationFn((params) => {
  return params.heightmapScale;
});
