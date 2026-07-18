---
# hello-terrain-4v72
title: Fix tile slot eviction on zoom out
status: in-progress
type: bug
created_at: 2026-06-28T16:53:39Z
updated_at: 2026-06-28T16:53:39Z
---

High LOD tiles persist after zoom out, causing overlapping renders and FPS drops. Fix slot cache eviction, runner idle skip, and abort-induced partial graph state.