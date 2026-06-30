---
# hello-terrain-btl9
title: Implement GPU agent lab harness
status: completed
type: task
priority: normal
created_at: 2026-06-26T20:51:40Z
updated_at: 2026-06-26T21:20:01Z
---

Add a first vertical slice of an agent-readable GPU lab: a browser route in the docs app that runs real WebGPU terrain tasks, exposes a window API returning structured JSON metrics/assertions/readbacks, and a Node CLI helper that can drive the route through Chrome DevTools. Keep scope narrow and avoid disturbing existing terrain runtime behavior.