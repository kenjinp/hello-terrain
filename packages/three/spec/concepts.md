# Core Concepts

## Runtime

`createTerrain` owns accepted configuration, backend production, render publication, CPU snapshots, and resource retirement. Each instance has separate mutable state. Applications configure and update the runtime rather than coordinate its backend tasks.

## Topology and projection

Topology defines roots, neighbor relationships, conservative bounds, and connectivity. A surface projection defines datum mapping, displacement direction, and CPU/GPU geometry operations. Built-in topologies cover bounded and infinite flat terrain, cube spheres, and toruses.

Flat elevation displaces along local +Y; curved elevation follows the datum direction, reversed for inverted configurations. Topology dimensions and centers are in the terrain coordinate system. Bindings apply scene placement.

## Elevation source and fields

An ordinary TSL callback produces unscaled scalar displacement. Its declared finite range bounds production before sampled data is available. `elevationScale` is applied once to geometry and query displacement.

The elevation field is the computed sample grid. The render field contains normalized elevation and terrain-local geometric normals. CPU snapshots reconstruct raw f32 elevation, so representation and normal differences require tolerances.

Normals use local gradients or curved datum derivatives with height differences. The material's detail normal is a separate shading value.

## Coordinates and precision

CPU query positions and datum anchors retain binary64 precision. Rendering transforms anchors before rounding small view offsets and combines them with local GPU residuals.

Source coordinates remain independent of camera movement. Absolute shader coordinates retain f32 limits. Regional mappings supply bounded coordinates where production metadata is available; they do not automatically solve source seams, filtering, or texture phase.

## Queries and residency

`TerrainQuery` accepts local Vec3 tuples. Available results contain position, normal, scaled elevation, revision, tile identity, and nominal sample spacing. Unavailable results identify missing coverage, stale data, disabled readback, or other explicit conditions.

A binding converts scene-space queries. Snapshot leases pin CPU records; binding leases also pin placement. Queries approximate a sampled surface, not exact rendered triangles. Raycasts return hit or incomplete, not an authoritative miss.

Residency follows the supplied view. Infinite terrain connectivity does not imply unlimited CPU collision coverage.

## Materials and maps

`TerrainMaterialContext` supplies pre-skirt elevation, datum/base normals, slope cosine, and source coordinates as TSL nodes. Source mappings control texture placement independently of geometry and texture ownership.

Maps are authored texture-like inputs; fields are computed spatial datasets; buffers/storage are concrete containers. Weights, categorical IDs, masks, and color textures have distinct interpretation and sampling rules.

Live appearance inputs stay outside snapshot guarantees. Managed source edits declare consumers and coordinate mutation, invalidation, and retirement. Appearance-only changes reuse geometry.

## React

React owns a runtime lifecycle lease and a scene binding. It applies changed data props after commit and uses the same update machinery as vanilla Three. Status subscriptions distinguish render publication from CPU query freshness; each query still checks coverage.

## Skirts

The geometry retains an outer ring for skirts, with its undeformed positions duplicated at the tile border. Vertex-index classification identifies this ring; testing whether a position lies outside the clamped tile cannot identify skirt vertices. Precision and ordinary vertex paths both apply `skirtScale` along the topology's displacement direction. Skirts cover cracks rather than making mixed-LOD edge samples identical, and their depth must suit the terrain's scale and resolution.
