---
# hello-terrain-eciz
title: Spread out and enlarge terrain stamps
status: completed
type: feature
priority: normal
created_at: 2026-03-19T12:49:57Z
updated_at: 2026-03-19T12:50:26Z
---

Adjust the raycast character controller terrain stamp layout so the major landforms are spaced farther apart and scaled up substantially.

## Checklist
- [x] Inspect current stamp placement and scale
- [x] Spread major stamp formations farther apart
- [x] Increase radii/heights so the formations read at a larger world scale
- [x] Verify touched files with lint diagnostics

## Notes

- Increased the broad hills base from `520` radius to `760` radius so the entire terrain reads as one larger basin.
- Pushed the four main `plateausTalus` masses outward into roughly `280-604` world-space offsets and increased them into roughly `332-368` radius / `0.38-0.44` height formations.
- Enlarged the long ridge and terrace features into roughly `348-512` radius landforms and moved them farther from center so the scene feels less crowded near spawn.
- `ReadLints` reported no diagnostics for `apps/docs/src/examples/RaycastCharacterControllerScene.tsx`.