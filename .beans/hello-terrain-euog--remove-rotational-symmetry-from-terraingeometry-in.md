---
# hello-terrain-euog
title: Remove rotational symmetry from TerrainGeometry inner segments
status: completed
type: task
priority: normal
created_at: 2026-01-16T14:05:33Z
updated_at: 2026-01-16T14:07:59Z
---

Modify `packages/three/src/geometry/TerrainGeometry.ts` to remove the rotational symmetry from the inner segments of the terrain geometry.

## Current Behavior
The current implementation uses a quadrant-based diagonal flip pattern where:
- Top-left and bottom-right quadrants use one diagonal (a-d)
- Top-right and bottom-left quadrants use the other diagonal (b-c)

This creates rotational symmetry across the entire mesh.

## Desired Behavior
- **Inner segments**: All triangles should "point" in the same direction (consistent diagonal across all quads)
- **Skirt ring**: The outermost ring (skirt vertices) should retain the current rotational symmetry pattern for proper skirt corner handling

## Implementation Approach
1. Identify which cells belong to the inner grid vs the skirt ring
2. For inner cells: use a consistent diagonal direction (e.g., always a-d or always b-c)
3. For skirt cells (first/last row and column): keep the existing quadrant-based flip logic

## Checklist
- [x] Modify `generateIndices()` to distinguish between inner cells and skirt cells
- [x] Apply consistent diagonal for inner cells
- [x] Keep rotational symmetry for skirt ring cells
- [x] Test that the geometry still renders correctly
