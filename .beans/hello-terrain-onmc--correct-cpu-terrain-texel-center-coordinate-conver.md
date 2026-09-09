---
# hello-terrain-onmc
title: Correct CPU terrain texel-center coordinate conversion
status: completed
type: bug
priority: normal
created_at: 2026-09-06T20:44:28Z
updated_at: 2026-09-06T21:16:31Z
---

The analytic gym observed incorrect linear elevations from CPU queries while raw GPU elevation was correct. Texture UVs must convert to grid coordinates as uv*edge-0.5, not uv*(edge-1). Verify via analytic CPU/GPU/browser checks.