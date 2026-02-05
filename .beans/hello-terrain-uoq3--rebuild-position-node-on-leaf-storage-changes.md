---
# hello-terrain-uoq3
title: Rebuild position node on leaf storage changes
status: in-progress
type: bug
created_at: 2026-02-05T03:47:10Z
updated_at: 2026-02-05T03:47:10Z
---

Fix disappearing tiles by rebuilding the position node when leaf storage node reference changes.

## Checklist
- [ ] Track leaf storage node reference from graph
- [ ] Rebuild positionNode when node changes
- [ ] Confirm mesh count still synced