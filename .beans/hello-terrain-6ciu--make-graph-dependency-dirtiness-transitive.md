---
# hello-terrain-6ciu
title: Make graph dependency dirtiness transitive
status: completed
type: bug
priority: normal
created_at: 2026-02-01T02:39:41Z
updated_at: 2026-02-01T02:39:54Z
---

Fix memo cache invalidation so downstream tasks become dirty when an upstream task is dirty due to param changes (transitive dirtiness).

## Checklist
- [x] Update computeDirty() to consider upstream task dirtiness transitively
- [x] Avoid infinite recursion on cycles (fail safe)
- [ ] Update/verify graph.test.ts failing case passes