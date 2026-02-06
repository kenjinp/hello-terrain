---
# hello-terrain-w0es
title: Disable frustum culling for GPU-scaled terrain
status: completed
type: bug
priority: normal
created_at: 2026-02-06T03:17:00Z
updated_at: 2026-02-06T03:17:08Z
---

Ensure terrain scaled on GPU is not culled by small CPU bounds.\n\n## Checklist\n- [x] Disable frustum culling or expand bounds for TerrainMesh\n- [x] Verify behavior with rootSize changes\n- [x] Mark bean complete