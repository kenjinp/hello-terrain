---
# hello-terrain-ykib
title: Mark terrain textures as repeating
status: completed
type: task
priority: normal
created_at: 2026-03-18T21:54:24Z
updated_at: 2026-03-18T21:54:47Z
---

Update TerrainTexturingScene texture setup so loaded KTX2 textures are explicitly configured for repeat wrapping (wrapS/wrapT) to avoid clamped seams and ensure tiled sampling.