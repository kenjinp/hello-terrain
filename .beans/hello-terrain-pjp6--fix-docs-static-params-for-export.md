---
# hello-terrain-pjp6
title: Fix docs static params for export
status: completed
type: task
priority: normal
created_at: 2026-02-01T05:39:32Z
updated_at: 2026-02-01T05:39:55Z
---

Fix Next.js output: export error about missing /docs/[[...slug]] param by ensuring generateStaticParams includes the empty slug for optional catch-all routes. Also fix Work docs internal links pointing to /docs/work instead of /work.