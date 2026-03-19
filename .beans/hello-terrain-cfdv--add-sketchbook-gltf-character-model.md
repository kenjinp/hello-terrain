---
# hello-terrain-cfdv
title: Add Sketchbook GLTF character model
status: completed
type: feature
priority: normal
created_at: 2026-03-19T10:39:14Z
updated_at: 2026-03-19T10:42:26Z
---

Replace the temporary procedural character mesh with the character GLTF from the Sketchbook repository and integrate it into the reusable docs controller.

## Checklist
- [x] Locate the Sketchbook character asset and supporting files
- [x] Add the model asset to the docs app
- [x] Update the character model component to load and render the GLTF
- [x] Verify lint diagnostics for touched files

## Notes

- Upstream asset used: `build/assets/boxman.glb` from the Sketchbook repository.
- The GLB includes animation clips such as `idle`, `run`, `sprint`, `jump_idle`, `jump_running`, and `falling`, which are now mapped onto the current controller motion states.