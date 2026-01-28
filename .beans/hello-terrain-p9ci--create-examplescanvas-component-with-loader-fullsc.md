---
# hello-terrain-p9ci
title: Create ExamplesCanvas component with loader, fullscreen, and UI toggle
status: completed
type: feature
priority: normal
created_at: 2026-01-28T04:11:14Z
updated_at: 2026-01-28T04:14:54Z
---

Create a reusable ExamplesCanvas component that wraps all example scenes with:
1. LoadingBar integration (existing component)
2. Fullscreen button (similar to ExampleLayout)
3. A button to toggle visibility of any UI overlays that examples layer on top

The component should:
- Accept children (the Canvas and scene content)
- Provide a context or callback for examples to register their UI overlays
- Style the buttons tastefully in a consistent manner
- Be used across all example scenes

## Checklist
- [x] Create ExamplesCanvas component with fullscreen and UI toggle buttons
- [x] Integrate LoadingBar
- [x] Create context for UI visibility state
- [x] Update MaterialsBCNScene to use ExamplesCanvas
- [x] Update TerrainGeometryScene to use ExamplesCanvas
- [x] Update QuadtreeScene to use ExamplesCanvas
- [x] Update QuadtreeCanvas to use ExamplesCanvas