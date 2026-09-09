---
# hello-terrain-5vrt
title: Assess planet-scale precision in runtime proposal
status: completed
type: task
priority: normal
created_at: 2026-09-06T20:27:46Z
updated_at: 2026-09-06T20:28:22Z
---

Assessed the proposal and current sphere/tile/normal/storage shader paths. Terrain-local coordinates are centered on the planet, so they remain planet-sized; tile-local offsets only help if projection, elevation evaluation, normals, and final view transformation preserve them without reconstructing absolute f32 positions.

Calculated IEEE binary32 representable spacing: at 1km 0.061mm; 10km 0.977mm; 100km 7.813mm; Earth-radius component 6371000m 0.5m. CPU binary64 spacing at Earth radius ~0.93nm. These are representation steps, not full numerical or geometric error bounds. Normalized f16 elevation across a 100m range can have ~4.9cm steps near the upper half.

Recommendation: CPU f64 terrain frame; f64 stable tile anchors and precision-safe curved local projection; GPU local residual positions and normalized directions; camera-relative anchor subtraction in CPU f64 or validated high/low arithmetic before adding residuals. Preserve stable procedural coordinates with split/cell coordinates, canonical shared edges, local normal reconstruction, explicit elevation quantization budget, and separate depth precision policy. Avoid treating tangent planes as exact sphere patches. math Vec3 tuples preserve CPU JS number precision but do not change shader precision. No proposal edits or runtime reproduction performed.
