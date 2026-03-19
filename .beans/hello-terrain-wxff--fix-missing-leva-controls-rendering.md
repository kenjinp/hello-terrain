---
# hello-terrain-wxff
title: Fix missing Leva controls rendering
status: completed
type: bug
priority: normal
created_at: 2026-03-18T21:57:55Z
updated_at: 2026-03-18T21:59:36Z
---

Controls toggle opens but no controls are displayed in TerrainTexturingScene. Diagnose Leva store/registration wiring and update scene to register controls to the panel store.