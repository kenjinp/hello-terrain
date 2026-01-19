---
# hello-terrain-e6hr
title: Remove threejs dependency in quadtree
status: completed
type: task
priority: normal
created_at: 2026-01-19T05:23:33Z
updated_at: 2026-01-19T15:02:07Z
---

We should remove the threejs dependency. We should move the frustrum logic to a generic callback predicate for early exit in the update loop. People should be able to use this data structure without threejs

