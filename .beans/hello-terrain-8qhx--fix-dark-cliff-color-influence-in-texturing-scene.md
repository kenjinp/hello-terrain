---
# hello-terrain-8qhx
title: Fix dark cliff color influence in texturing scene
status: in-progress
type: bug
created_at: 2026-03-18T22:07:28Z
updated_at: 2026-03-18T22:07:28Z
---

Investigate dark color shift when cliff texture influences blending in TerrainTexturingScene. Align texture color handling with materials reference and adjust blend/color mapping so cliff contribution does not appear unnaturally dark.