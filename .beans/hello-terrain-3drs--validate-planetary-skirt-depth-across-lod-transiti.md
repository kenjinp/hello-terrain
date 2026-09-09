---
# hello-terrain-3drs
title: Validate planetary skirt depth across LOD transitions
status: todo
type: task
created_at: 2026-09-07T02:54:29Z
updated_at: 2026-09-07T02:54:29Z
---

The multiple-planets demo uses fixed 300-metre skirts with exaggerated planetary relief. After restoring skirt extrusion in the precision shader, reproduce the supplied seam screenshot and measure whether this depth covers curvature/interpolation gaps at mixed LOD. Consider depth derived from tile size/error rather than simply increasing a global constant; keep precision and surface-query contracts.