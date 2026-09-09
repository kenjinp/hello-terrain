---
# hello-terrain-u47n
title: Validate planetary precision before runtime refactor
status: completed
type: task
priority: normal
created_at: 2026-09-06T20:52:10Z
updated_at: 2026-09-07T00:24:18Z
---

Follow up hello-terrain-g7gb committee consensus. Add real WebGPU constant-elevation Earth fixtures and a CPU f64 datum oracle. Measure position, normals, temporal stability, all face and mixed-LOD boundaries, field packing, CPU/GPU reconstruction and Three lighting/shadow/secondary-pass integration. Compare stable GPU curved residuals against CPU datum baseline. Define a finite supported envelope and adopt measured precision requirements into the runtime proposal before freezing coordinate APIs. Preserve ordinary TSL and source identity; do not promise arbitrary callback accuracy or smoothness.

Implemented and validated under hello-terrain-hboy, following the explicit implementation handoff authorization. See the adopted runtime proposal for contracts, measured finite precision limits, and passing browser artifacts. Earlier draft scope text is historical.
