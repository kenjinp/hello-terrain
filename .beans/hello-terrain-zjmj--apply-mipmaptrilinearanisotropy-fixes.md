---
# hello-terrain-zjmj
title: Apply mipmap/trilinear/anisotropy fixes
status: completed
type: bug
priority: normal
created_at: 2026-03-18T22:47:02Z
updated_at: 2026-03-18T22:48:15Z
---

Use standard texture anti-aliasing setup in TerrainTexturingScene: mipmaps, trilinear min filter, linear mag filter, and anisotropic filtering. Remove ad-hoc screen-space blur controls and sampling path.