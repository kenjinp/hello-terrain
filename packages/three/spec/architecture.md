# Terrain Architecture

The instance-owned runtime is the standard application boundary. React and vanilla Three use the same production, publication, query and disposal machinery.

## Layers

- `runtime/runtime.ts`: renderer-independent configuration acceptance, serialized candidate production, revisions, status subscription, snapshot retention/leases and lifecycle. No Three imports.
- `runtime/source.ts`: optional managed-source edit boundaries, declared consumers and retirement acknowledgement. Raw appearance textures remain valid outside this protocol.
- `runtime/precision.ts`, `runtime/fieldLayout.ts`: CPU binary64 datum oracle and shared scalar layout constants. CPU math uses pinned `math` tuples and output-first operations.
- `quadtree/`: topology, adjacency, conservative bounds, balancing and residency. Retain the existing mechanisms and capacity model.
- `projection/`: shape-specific CPU math and explicit GPU adapter hooks. Pipeline dispatch uses capabilities, never projection-kind switches. Topology factories copy geometry inputs and expose resolved datum dimensions.
- `tasks/`, `gpu/`, `tsl/`: explicit Three/WebGPU backend integration, existing task scheduler, shader authoring and storage. These are integration modules, not the renderer-independent core.
- `runtime/three.ts`: Three backend, bounded reusable candidate slots, resource teardown, coherent source copies and query integration.
- `runtime/binding.ts`, `mesh/`, `geometry/`: scene transforms, owned meshes/geometry and borrowed material attachment. Positions/normals cross the math/Three boundary explicitly.
- `query/`: raw-f32 CPU snapshot reconstruction and Three consumer integration. Generic runtime queries return package Vec3 tuples and explicit availability. GPU resident sampling is distinct from authored source evaluation.
- `@hello-terrain/react`: lifecycle lease, committed configuration updates, frame driving and subscribed publication. It contains no separate terrain task runner.

## Publication

An accepted configuration is immutable data with explicitly borrowed functions/topologies/sources. Production uses a candidate slot; the last good render slot remains available if preparation fails. Complete node/storage/count/config records publish together. Paired elevation/bounds copies submit before either mapping awaits, and CPU publication captures matching index, source version and interpretation.

A published CPU record is never reused as a readback destination. Leases pin independent copies; resource retirement waits for submitted compute/draw/transfers. GPU fields, staging buffers and compute kernels belong to the backend. Borrowed renderers, textures and materials are never implicitly destroyed. Snapshot retention reports backpressure when pinned records exhaust the configured cap.

## Coordinates and material integration

Geometry has one resolved authority. Core samples are terrain-local; elevation is scaled displacement along the datum direction. Bindings convert scene positions/rays and inverse-transpose normals exactly once, rejecting singular transforms.

Stable CPU datum anchors are transformed to each camera in binary64 before small view offsets round to f32. Flat, sphere and torus render kernels assemble local residuals. Sphere/torus normals use datum derivatives and local height differences. Absolute source/world coordinates retain their meaning and f32 limits. In particular, world-space shadow receiving and arbitrary source expressions have separate precision limits; local-view validation is not a universal shadow or source guarantee.

Materials receive pre-skirt elevation, datum normal, geometric base normal and source mappings. User materials own color, roughness, opacity and detail normals. Mapped detail normals use derivatives of their own mapping. Appearance-only managed edits do not produce geometry or query readback. Compatible resource updates retain material identity while permitting shader recompilation.

## Backend scheduling

Camera movement first runs the quadtree selection target on an instance-owned CPU task graph. Its allocation tasks remain cached. If selected tile identities match the current publication and the accepted edit is unchanged, rendering and query revisions remain stable: compute, readback, and material-node publication are skipped. Actual layout changes and accepted edits still use candidate production. The selection graph is separate from published graph records so their CPU indices continue to match their GPU fields.


Tasks are backend implementation details. Applications use runtime transactions and published queries. A public generic field graph and second rendering backend are not implemented.
