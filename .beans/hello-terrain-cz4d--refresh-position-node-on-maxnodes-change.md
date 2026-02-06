---
# hello-terrain-cz4d
title: Refresh position node on maxNodes change
status: in-progress
type: bug
created_at: 2026-02-05T03:45:00Z
updated_at: 2026-02-05T03:45:00Z
---

Fix missing tiles when maxNodes changes by recreating position node to use updated leaf storage.

## Checklist
- [ ] Re-evaluate positionNode memo dependencies
- [ ] Ensure leafStorage changes trigger positionNode rebuild
- [ ] Validate render updates after maxNodes changes