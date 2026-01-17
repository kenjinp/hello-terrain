---
# hello-terrain-ql12
title: Add animated contour-lines background canvas to docs app
status: completed
type: feature
priority: normal
created_at: 2026-01-16T15:17:57Z
updated_at: 2026-01-16T15:33:03Z
---

Create a full-screen background canvas at the app level of the docs site that shows a subtle animated contour-lines effect (mimicking terrain topographic contour lines). Requirements:
- Takes up entire screen
- Positioned behind all text content
- Subtle enough not to interfere with reading
- Animated effect
- **Uses Three.js with a custom shader for GPU-accelerated rendering**

## Checklist
- [x] Explore docs app layout structure
- [x] Create ContourBackground component with canvas
- [ ] Implement contour lines effect using Three.js shader
- [x] Add component to app layout
- [ ] Test the visual result