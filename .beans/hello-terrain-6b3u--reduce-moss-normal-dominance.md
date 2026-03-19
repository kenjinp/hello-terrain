---
# hello-terrain-6b3u
title: Reduce moss normal dominance
status: completed
type: bug
priority: normal
created_at: 2026-03-18T22:17:01Z
updated_at: 2026-03-18T22:17:34Z
---

Moss normal map influence remains overpowering compared to base texture normals in TerrainTexturingScene. Add explicit control to damp overlay normal influence and use capped blend for normal mixing.