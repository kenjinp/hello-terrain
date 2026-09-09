---
# hello-terrain-rd74
title: Decide fate of unassigned vElevation / vGlobalVertexIndex varyings
status: todo
type: task
priority: low
tags:
    - tsl
    - api
created_at: 2026-09-04T19:18:49Z
updated_at: 2026-09-04T19:18:49Z
---

packages/three/src/tsl/varyings.ts exports vElevation and vGlobalVertexIndex varyingProperty handles, but nothing in packages/three/src assigns them (the position node only assigns normalLocal). Docs (PR #25) now say consumers must assign them in a vertex-stage wrapper. Either have the position node populate them or drop the exports.