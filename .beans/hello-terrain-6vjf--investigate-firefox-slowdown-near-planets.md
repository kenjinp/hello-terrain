---
# hello-terrain-6vjf
title: Investigate Firefox slowdown near planets
status: completed
type: task
priority: normal
created_at: 2026-09-07T03:05:23Z
updated_at: 2026-09-07T03:07:18Z
---

Completed local investigation and added a reproducible --approach profiler mode and benchmark report. Chromium SwiftShader: whole-system stationary 39.6 ms/frame; approach 47.3 with four render pipelines and eight mappings; closer stationary 52.3 with zero shader creation, compute, or readback; suppressing WebGPU draws 25.7. This identifies sustained rendering cost separately from genuine LOD pipeline changes, but cannot establish the reported Firefox-specific cause. Firefox is not installed and user hardware/version and stationary behavior are not yet available. No rendering or precision settings changed. Script syntax and diff checks passed.