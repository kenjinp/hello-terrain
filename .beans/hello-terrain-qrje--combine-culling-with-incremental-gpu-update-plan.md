---
# hello-terrain-qrje
title: Combine culling with incremental GPU update plan
status: completed
type: task
priority: normal
created_at: 2026-06-27T01:42:18Z
updated_at: 2026-06-27T01:48:03Z
---

Update the incremental GPU terrain update plan so frustum/horizon culling and
incremental dirty-tile updates are designed as one pipeline.

## Checklist

- [x] Read the existing incremental update plan.
- [x] Add culling-aware architecture and phased implementation steps.
- [x] Validate markdown and complete the bean.
