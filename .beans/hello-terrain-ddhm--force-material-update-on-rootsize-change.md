---
# hello-terrain-ddhm
title: Force material update on rootSize change
status: completed
type: bug
priority: normal
created_at: 2026-02-06T03:20:09Z
updated_at: 2026-02-06T03:20:30Z
---

Invalidate NodeMaterial on rootSize changes so GPU uniform updates take effect without HMR.\n\n## Checklist\n- [x] Invalidate material/positionNode on rootSize change\n- [x] Verify update happens without HMR\n- [x] Mark bean complete