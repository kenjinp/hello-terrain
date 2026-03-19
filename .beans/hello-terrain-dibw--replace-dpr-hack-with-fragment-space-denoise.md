---
# hello-terrain-dibw
title: Replace DPR hack with fragment-space denoise
status: completed
type: bug
priority: normal
created_at: 2026-03-18T22:30:52Z
updated_at: 2026-03-18T22:32:18Z
---

User requested a screen-space fragment shader solution, not render resolution scaling. Implement shader-level denoising in TerrainTexturingScene using derivative-based LOD bias/smoothing and remove screenSpaceResolution DPR control.