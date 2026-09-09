# Terrain Data Model

## Accepted configuration

`TerrainConfig` supplies a copied topology definition/reference, elevation callback and conservative unscaled range, scale, tile resolution, internal node/storage capacity, maximum level, skirt depth, storage format/filter and LOD policy. Topology factories copy their caller's data. Flat root dimensions and curved projection dimensions feed CPU and GPU from the same resolved values.

`maxNodes` preserves the existing internal node capacity. It is not a promise of that many simultaneous leaves. Device limits and memory remain backend constraints; numeric defaults do not establish a performance budget.

## Render production

`TerrainRevision` records instance identity, production order, accepted config, source content and accepted edit versions. `TerrainRender` bundles config, leaf count, position node, material context and an inspectable backend graph. Candidate resources are independent of the last published render resources. Backend slots are reused after safe retirement.

## CPU snapshots

GPU elevation and bounds transfers capture the spatial index and CPU interpretation before asynchronous mapping. Both source copies submit before mapping awaits. A complete snapshot then publishes atomically; zero-height data is valid. Failed or disposed transfers cannot replace the last good record.

The CPU mirror reconstructs raw float32 elevations. Rendering defaults to a normalized rgba16float field plus per-tile pack bounds; rgba32float is an explicit diagnostic option. CPU/render parity therefore includes storage and normal-reconstruction tolerance rather than bit equality. Adjacent pack ranges can yield slightly different decoded border values.

The current CPU record is copied independently from reusable transfer buffers. Leases pin records for batch/physics work and survive runtime teardown until released. Scalar sample positions and normals use `math` Vec3 tuples. Batch input positions and output positions, normals, and elevations use Float64Array. A released lease cannot be queried. Retention limits produce backpressure instead of silently overwriting pinned records.

## Fields and containers

- `LeafSet`: CPU tile addresses `(space,level,x,y)`.
- `leafStorage`: GPU address buffer; slots are transient transport addresses, not source identity.
- `elevationField`: computed raw scalar displacement in unscaled source units.
- `terrainFieldStorage`: `[normalizedHeight,Nx,Ny,Nz]`, with local geometric normals.
- `tileBounds`: inner LOD min/max plus all-vertex pack min/max; all zero is valid.
- `datum anchors`: stable binary64 local points; per-camera view anchors round only after CPU transformation/cancellation.
- `materialContext`: interpolated pre-skirt scaled elevation, datum/base normals, datum position and source coordinates. These are not a public generic attribute snapshot graph.

## Managed inputs

A managed source borrows its texture/uniform data. Declared consumers determine invalidation. Edits wait for already submitted consumer work, run a synchronous mutator, then invalidate only affected consumers. Texture replacement reports a retirement promise; compatible texture schema can preserve sampler/material identity. External writes bypassing managed edits are outside coherent snapshot guarantees.

Source mapping is independent of topology, ownership, decode and streaming. Fixed regional mappings subtract tile-address contributions before fractional coordinates are added. Faces, region coverage, seams and phase must be explicit in authored composition. Weights, independent masks and categorical IDs have different sampling semantics.

## Framework ownership

The runtime owns data production. A Three binding owns scene primitives and default material, restoring borrowed position attachments during teardown. React owns a runtime lifecycle lease and binding acquisition; it applies committed config and drives the same runtime update method. Published render availability and query freshness are independent, and coverage remains a per-query result.
