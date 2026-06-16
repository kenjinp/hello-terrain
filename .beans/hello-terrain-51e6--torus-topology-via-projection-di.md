---
# hello-terrain-51e6
title: Torus topology via projection DI
status: completed
type: feature
priority: normal
created_at: 2026-06-16T11:35:52Z
updated_at: 2026-06-16T12:14:33Z
---

Add createTorusTopology (closed donut) with full render+LOD+query+raycast parity. Replace the projection string discriminant with an injected SurfaceProjection strategy carried by each Topology, deleting all if(projection===...) branches. Implement torus as a third projection. Add example page + docs + tests. See plan torus_topology_via_projection_di.