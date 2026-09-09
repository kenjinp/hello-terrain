---
# hello-terrain-8ygn
title: Refresh stationary terrain edits and isolate origin uniforms
status: completed
type: bug
priority: normal
created_at: 2026-09-06T20:45:50Z
updated_at: 2026-09-06T21:16:32Z
---

Gym stationary-edit reproduces stale CPU snapshots because readback deduplicates solely by topology stamp. Include compiled elevation pipeline identity in readback scheduling. Multi-instance fixture also targets the known shared origin vector; preserve each terrain uniform vector instead. Verify with end-to-end edit/isolation scenarios and controlled CPU readback tests.

Controlled delayed-readback tests also exposed publication after disposal and failure to retry rejected reads. Added disposal guards and retry invalidation; three snapshot tests pass. Browser stationary edits and peer isolation pass.
