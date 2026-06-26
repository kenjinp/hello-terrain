---
# hello-terrain-nsv2
title: Investigate zero GPU timestamp samples
status: completed
type: task
priority: normal
created_at: 2026-06-26T21:23:20Z
updated_at: 2026-06-26T21:30:41Z
---

Found and fixed the zero timestamp cause. Three.js WebGPU only honors trackTimestamp when the backend is constructed/initialized; the lab was setting renderer.trackTimestamp after init, which did not enable backend timestamp writes. The profiler also collapsed missing/stale samples to 0ms. The lab now passes trackTimestamp: true into WebGPURenderer construction, reports backend/query-pool diagnostics, and returns null for missing fresh samples instead of synthetic zeros. Verified with real Chrome/WebGPU: computeQueryCount=6 and computeMs=0.123542/0.035912ms on measured frames.