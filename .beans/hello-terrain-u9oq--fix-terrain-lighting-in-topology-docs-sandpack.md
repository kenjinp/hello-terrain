---
# hello-terrain-u9oq
title: Fix terrain lighting in topology docs Sandpack
status: in-progress
type: bug
created_at: 2026-06-15T01:02:31Z
updated_at: 2026-06-15T01:02:31Z
---

The /docs/core/topology page's TopologySandpack relies on R3F <ambientLight>/<directionalLight> + meshStandardNodeMaterial. In Sandpack's bundler, fiber/drei load 'three' (core) while the app loads 'three/webgpu', producing two three instances ('Multiple instances of Three.js'). The renderer's LightsNode registry can't resolve the scene lights ('Light node not found for AmbientLight/DirectionalLight'), so terrain renders unlit.

Fix: match the SinWave/Fbm sandpacks — compute lighting in TSL via the material output node using normalWorld, and remove the R3F scene lights. The terrain GPU pipeline assigns world-space normals to normalLocal, so normalWorld is valid.

## Checklist
- [ ] Update buildAppCode in TopologySandpack.tsx to use meshBasicNodeMaterial with a TSL lighting outputNode
- [ ] Remove <ambientLight>/<directionalLight> from the generated Canvas
- [ ] Narrow extend() to MeshBasicNodeMaterial and update stale lights comment
- [ ] Verify in browser that all three tabs render lit terrain with no console errors