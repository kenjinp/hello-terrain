# Terrain Runtime Design

This document describes the implemented runtime. The [architecture](architecture.md), [data model](terrain-data-model.md), and [public runtime guide](../../../apps/docs/content/docs/docs/core/runtime.mdx) provide the corresponding implementation and API references.

## Ownership and configuration

Each runtime owns accepted configuration, candidate backend slots, complete render publication, CPU snapshot records, subscriptions, and disposal. Three scene bindings own their meshes and geometry. Supplied renderers, materials, textures, and callback dependencies remain borrowed.

Configuration acceptance validates and copies data settings. Topology factories copy their geometry inputs. Callback and topology identity changes are explicit replacements. Accepted descriptors must not be mutated behind the runtime.

The current Three configuration uses `maxNodes` as internal quadtree/storage capacity, `innerTileSegments` as field/geometry resolution, and distance LOD by default. Screen LOD is supported with a projection factor. These settings do not establish a byte budget or universal accuracy guarantee.

## Production and snapshots

A successful candidate publishes a complete render record. Failed preparation preserves the last good record. GPU elevation and bounds copies submit before either mapping awaits, capturing the same index and interpretation.

Revisions identify instance, configuration, source content, layout, production, and accepted edit. CPU and render revisions may differ. `requestSnapshot({ minEditVersion })` targets an accepted edit or newer and can schedule production after the first view has been supplied.

CPU snapshot records are copied independently from reusable transfer buffers. Leases pin records across replacement/disposal; retention admission reports backpressure. Failed transfers preserve the previous CPU snapshot.

Managed edits coordinate source mutation with consumer work and invalidate declared dependencies. Appearance-only edits advance presentation state while reusing geometry. Immutable metadata does not freeze externally mutated texture pixels.

## CPU math and coordinates

CPU vector/matrix operations use the pinned `math@1.0.0-canary-37519dcd-20260903` dependency. Public query vectors are number tuples; batch positions and outputs use Float64Array. Three objects are converted at integration boundaries.

The runtime uses terrain-local coordinates. Scene bindings apply affine placement and inverse-transpose normals; singular transforms fail explicitly. Elevation remains scaled local displacement under scene scale.

Rendering transforms binary64 datum anchors before rounding small view offsets. Built-in flat, sphere, and torus kernels evaluate local residuals; curved normals use datum derivatives and local height differences. Absolute source arithmetic and world-space shadow receiving retain separate precision limitations.

## Authoring and extension boundaries

Ordinary TSL defines elevation and material appearance. Materials receive direct pre-skirt elevation, datum/base normals, slope, and source mapping inputs. Users retain color, roughness, opacity, and detail-normal composition. Mapped normal helpers use the sampling mapping's derivatives.

Raw appearance textures need no managed wrapper, baking, or CPU readback. Optional managed sources provide explicit edit ordering and replacement retirement. Maps can drive multiple consumer classes. Mapping, data interpretation, lifetime, and residency are distinct responsibilities.

Fixed regional mappings are supported where production coordinates exist. They do not implement automatic region coverage, streaming, or seam blending. A source's sampling policy and its numerical limits remain explicit.

## Query semantics

The common query returns owned terrain-local tuples and availability metadata. Binding queries return scene positions/normals while retaining local elevation units. Leases support stable batches and physics steps.

CPU queries reconstruct raw f32 elevation; rendering may use normalized f16 elevation and different normal reconstruction. Mesh interpolation, packing, source evaluation, and numerical error are separate terms. Raycasts return hit or incomplete and do not promise exact triangle picking or authoritative misses.

## Validation and limits

Use the [terrain gym](../../../apps/docs/content/docs/docs/terrain-gym.mdx) to validate the current checkout. Required scenarios cover instance isolation, stationary edits, readback/publication, managed sources, material composition, transformed queries, and planetary precision. Read run artifacts rather than treating unavailable GPU execution as a pass.

Precision measurements in the runtime guide apply only to their tested fixtures. Arbitrary callbacks, all planetary shadow paths, seamless mixed-LOD borders, and every backend are not covered by a universal precision guarantee.

A generic public field graph, virtual-texture streaming, terrain editor, owned PBR stack, byte-budget admission, complete typed-error taxonomy, and automatic CPU translation of arbitrary TSL are not implemented.
