# TSL Nodes - Elevation Functions

This directory contains TSL (Three.js Shader Language) nodes for terrain generation, specifically elevation functions.

## Overview

The `Elevation.ts` file provides an `ElevationFn` function that allows you to create elevation functions with automatic typing. This eliminates the need for manual type annotations and provides a clean, developer-friendly interface.

## Usage

### Basic Elevation Function

```typescript
import { ElevationFn } from "./Elevation";
import { vec2_fbm } from "./fmb";

// Create an elevation function using ElevationFn - no manual typing needed!
const myElevationFunction = ElevationFn(({ worldUv, heightmapScale }) => {
  // Calculate height using FBM noise
  const height = vec2_fbm(
    worldUv,
    8,    // iterations
    1.0,  // amplitude
    2.4,  // frequency
    0.4,  // lacunarity
    0.85  // persistence
  );
  
  // Scale by heightmapScale and return
  return height.mul(heightmapScale);
});
```

### Using with HelloTerrain

```typescript
import { HelloTerrain } from "./HelloTerrain";

<HelloTerrain
  maxLevel={16}
  rootSize={256000}
  elevationNode={myElevationFunction}
  // ... other props
/>
```

## Parameters

The elevation function automatically receives the following parameters with proper typing:

- **`worldPosition`**: The 3D world position where elevation is being calculated
- **`rootSize`**: The size of the root terrain tile
- **`heightmapScale`**: Scaling factor for the height output
- **`worldUv`**: UV coordinates in world space (0-1)
- **`level`** (optional): Current quadtree level
- **`tileSize`** (optional): Size of current tile
- **`nodeX`** (optional): X coordinate of current node
- **`nodeY`** (optional): Y coordinate of current node

## Return Value

The function must return a value representing the height at the given position.

## Examples

See `ElevationExample.ts` for more detailed examples including:

- Simple FBM-based elevation
- Complex multi-level elevation with detail
- Integration with HelloTerrain component

## TSL Functions

The elevation functions use TSL (Three.js Shader Language) which provides:

- **`vec2_fbm`**: Fractal Brownian Motion noise for natural-looking terrain
- **`warp_fbm`**: Warped FBM for more complex terrain variation
- **`vec3`**: 3D vector operations
- **`float`**: Float operations
- **Mathematical operations**: `mul`, `add`, `div`, etc.

## Benefits of ElevationFn

1. **No Manual Typing**: Parameters are automatically typed based on the ElevationParams interface
2. **IntelliSense**: Full autocomplete and parameter hints in your IDE
3. **Type Safety**: Compile-time checking ensures your elevation functions are correct
4. **Clean API**: Simple function call without complex type annotations
5. **Consistency**: Follows the same patterns used throughout your codebase

## Tips

1. **Use `worldUv` for consistent noise**: This provides normalized coordinates that work well with noise functions
2. **Scale appropriately**: Use `heightmapScale` to control the overall height range
3. **Consider level-based detail**: Use the `level` parameter to add more detail at higher zoom levels
4. **Performance**: Keep elevation calculations simple as they run on every vertex
5. **Caching**: TSL automatically caches results, so complex calculations won't be repeated unnecessarily
