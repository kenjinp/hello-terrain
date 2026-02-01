---
# hello-terrain-kqq9
title: Add semaphore tests
status: in-progress
type: task
created_at: 2026-02-01T00:08:28Z
updated_at: 2026-02-01T00:08:28Z
---

Add vitest coverage for packages/work/src/semaphore/semaphore.ts\n\n## Checklist\n- [ ] Add semaphore tests covering acquire/release, waiting behavior, FIFO ordering\n- [ ] Cover permit coercion edge cases (floats, <=0, NaN)\n- [ ] Ensure tests run under vitest defaults