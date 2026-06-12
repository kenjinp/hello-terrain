---
# hello-terrain-57b8
title: Fix GPU readback buffer leak causing FPS hitches
status: completed
type: bug
priority: normal
created_at: 2026-06-12T02:44:04Z
updated_at: 2026-06-12T02:49:04Z
---

Replace Three.js getArrayBufferAsync (which leaks _readback GPU buffers each frame) with a reused, properly-destroyed staging buffer per attribute in the terrain readback path.