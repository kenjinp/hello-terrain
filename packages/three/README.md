# @hello-terrain/three

Adaptive WebGPU terrain for Three.js, with ordinary TSL elevation, instance-owned production, and coherent CPU snapshots.

## Runtime

```ts
import { createTerrain, createTerrainBinding } from "@hello-terrain/three";
import { sin } from "three/tsl";

const terrain = createTerrain({
  renderer, // initialized WebGPURenderer
  elevation: ({ worldPosition }) => sin(worldPosition.x.mul(0.1)),
  elevationRange: { min: -1, max: 1 },
  elevationScale: 10,
});
const binding = createTerrainBinding(terrain);
scene.add(binding.mesh);

// Before drawing, after updating camera/scene matrices:
await terrain.update(binding.viewFromCamera(camera, viewportHeight));
renderer.render(scene, camera);

const sample = binding.sampleWorld([0, 20, 0]);
if (sample.status === "available") console.log(sample.position);

await binding.dispose();
await terrain.dispose();
```

Topologies provide bounded/infinite planes, cube spheres, and toruses. Use node materials and the published material context for direct elevation, slope, mapped control textures, and detail normals. Managed sources support ordered edits and borrowed-resource retirement.

CPU queries return `math` tuples with availability and revision metadata. Leases support stable Float64 batches. Queries reconstruct sampled terrain and raycasts return hit or incomplete; they do not promise exact rendered triangles.

The runtime and precision APIs described here are implemented in this checkout. Use matching package builds. The WebGPU/backend precision limits and measured scenarios are documented in the runtime guide.

- [Runtime](https://hello-terrain.kenny.wtf/docs/core/runtime)
- [Configuration](https://hello-terrain.kenny.wtf/docs/core/params)
- [Materials](https://hello-terrain.kenny.wtf/docs/core/nodes/materials)
- [React setup](https://hello-terrain.kenny.wtf/docs/react/getting-started)
