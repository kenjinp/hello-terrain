---
# hello-terrain-i9b3
title: Force leaf buffer updates on leafSet changes
status: scrapped
type: bug
priority: normal
created_at: 2026-02-05T03:50:56Z
updated_at: 2026-02-05T03:52:56Z
---

Fix disappearing/overlapping tiles by ensuring leafGpuBufferTask updates when leafSet contents change (even if object reference reused).

## Checklist
- [ ] Inspect work graph caching semantics for reused objects
- [ ] Ensure quadtreeUpdateTask signals change per frame
- [ ] Update buffer task to run when leafSet changes