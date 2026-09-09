---
# hello-terrain-ue12
title: Single source of truth for radius/origin/rootSize between params and topology
status: in-progress
type: bug
priority: high
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T16:47:14Z
---

GPU uses the `radius` param via uRadius (uniforms.task.ts), while CPU LOD bounds, query and raycast use createCubeSphereTopology({ radius }) / projection.radius. Same duality for rootSize/origin vs createInfiniteFlatTopology({ rootSize, origin }). Users must set both consistently (docs show `<Terrain topology={...radius:1000} radius={1000}>`); mismatch silently desyncs GPU vs CPU.

## Checklist
- [ ] Derive uRadius from topology.projection.radius in updateUniformsTask (topologyTask already exposes it); fall back to param only when projection has none
- [ ] Decide whether rootSize/origin params should feed the topology or vice versa; make topologyTask the sole owner
- [ ] Deprecate or remove the `radius` param and the React `radius` prop; update apps/docs (core/params.mdx, core/topology.mdx, examples)