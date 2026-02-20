---
# hello-terrain-fcxs
title: Allow direct values in param and graph set
status: completed
type: feature
priority: normal
created_at: 2026-02-20T08:16:51Z
updated_at: 2026-02-20T08:18:07Z
---

Implement value-or-callback setter input for @hello-terrain/work params and graph-owned params, update tests, and refresh docs examples to show direct value usage.\n\n## Checklist\n- [x] Update param and graph set type signatures to accept value-or-callback\n- [x] Update param runtime set implementation for direct values\n- [x] Update graph runtime set implementation for direct values\n- [x] Export new setter input type from package index\n- [x] Add/adjust unit tests for param direct-value set\n- [x] Add/adjust unit tests for graph direct-value set\n- [x] Update work param docs for dual set API