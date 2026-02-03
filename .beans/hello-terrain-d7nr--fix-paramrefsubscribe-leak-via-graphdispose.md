---
# hello-terrain-d7nr
title: Fix ParamRef.subscribe leak via Graph.dispose
status: in-progress
type: bug
created_at: 2026-02-02T17:30:48Z
updated_at: 2026-02-02T17:30:48Z
---

ParamRef.subscribe appears to never be unsubscribed, risking leaks when graphs/tasks are created and discarded.

## Checklist
- [ ] Find all ParamRef.subscribe callsites and confirm returned unsubscribe API
- [ ] Add disposal mechanism (e.g. Graph.dispose / WorkGraph.dispose) that unsubscribes ParamRef subscriptions
- [ ] Ensure callers invoke dispose or provide helper to auto-dispose
- [ ] Add/adjust tests to verify subscriptions are cleaned up
- [ ] Run relevant test suite(s)