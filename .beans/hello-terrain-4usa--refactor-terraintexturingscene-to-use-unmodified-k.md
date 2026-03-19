---
# hello-terrain-4usa
title: Refactor TerrainTexturingScene to use unmodified KTX2 textures
status: completed
type: task
priority: normal
created_at: 2026-03-18T21:13:37Z
updated_at: 2026-03-18T21:13:40Z
---

Update docs terrain texturing example to remove synthetic layer generation and directly sample unmodified MaterialsBCN KTX2 textures. Keep textureControlFn as the control authoring API to apply cliff stone on slopes and moss overlay on forest floor. Verify lint/typecheck after refactor.