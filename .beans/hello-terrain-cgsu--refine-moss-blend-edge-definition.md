---
# hello-terrain-cgsu
title: Refine moss blend edge definition
status: completed
type: bug
priority: normal
created_at: 2026-03-18T22:12:25Z
updated_at: 2026-03-18T22:12:55Z
---

Moss appears too strong even at tiny influence in TerrainTexturingScene. Tighten moss mask edges and reduce height-blend amplification at low blend values so transition boundaries are more defined.