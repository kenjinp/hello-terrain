---
# hello-terrain-hftq
title: 'Torus example: clicks fail when camera is inside the pick-target sphere'
status: completed
type: bug
priority: normal
created_at: 2026-06-17T16:16:30Z
updated_at: 2026-06-17T16:16:44Z
---

User report: in apps/docs/src/examples/TorusTerrainScene.tsx, clicking the torus to drop a sphere works when the camera is outside the torus radius (position A) but does nothing when the camera is above the donut within the radius (position B).

Root cause: the invisible pick-target mesh is a sphere of radius pickRadius*1.3 enclosing the donut, using a default-side (THREE.FrontSide) material. R3F's pointer raycaster honors material.side. When the camera is outside the enclosing sphere the pointer ray hits the front face and onPointerDown fires; when the camera is inside the enclosing sphere (above the hole / within the bounding radius) the ray only meets the inner back faces, which FrontSide culls, so onPointerDown never fires. The torusRaycast math itself is correct. The cube-sphere example shares the pattern but never triggers it because the camera always stays outside the planet.

Fix: make the invisible pick-target sphere material double-sided (side={THREE.DoubleSide}) so pointer events fire whether the camera is inside or outside the enclosing sphere; raycast.pick(event.ray) then resolves the precise hit as before.