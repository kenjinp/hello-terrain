# Hello Terrain

High performance terrain system for [three.js](https://threejs.org/) and [react-three/fiber](https://r3f.docs.pmnd.rs/getting-started/introduction)

## `@hello-terrain/three`

### Installation

```bash
# For React/React Three Fiber usage
pnpm add @hello-terrain/react @hello-terrain/three three @react-three/fiber

# For vanilla Three.js usage (without React)
pnpm add @hello-terrain/three three
```

### Basic Usage

Here's a complete example of how to use the library:

```tsx
import * as hello from "@hello-terrain/react";
import { ElevationFn, type TerrainMesh } from "@hello-terrain/three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useState } from "react";
import {
  Fn,
  float,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

const TerrainPlane = () => {
  const { camera, gl } = useThree();
  const [terrainMesh, setTerrainMesh] = useState<TerrainMesh | null>(null);

  // 1. Create uniforms for elevation parameters
  const elevationUniforms = useMemo(() => {
    return {
      uFbmIterations: uniform(8).setName("uFbmIterations"),
      uFbmAmplitude: uniform(100.0).setName("uFbmAmplitude"),
      uFbmFrequency: uniform(0.1).setName("uFbmFrequency"),
      uHeightmapScale: uniform(1.0).setName("uHeightmapScale"),
      uNoiseScale: uniform(0.01).setName("uNoiseScale"),
    };
  }, []);

  // 2. Create varyings for shader communication
  const varyings = useMemo(() => {
    return {
      vElevation: varying(float(), "vElevation"),
    };
  }, []);

  // 3. Define elevation function using TSL (Three Shading Language)
  const elevationFn = useMemo(() => {
    return ElevationFn(({ worldPosition }) => {
      const noiseScale = elevationUniforms.uNoiseScale;
      // Use worldPosition to calculate height
      // This runs in a compute shader for all terrain vertices
      // Example: simple height based on position
      const height = vec2(worldPosition.x, worldPosition.z)
        .mul(noiseScale)
        .length()
        .mul(elevationUniforms.uHeightmapScale);

      return height;
      // For more complex terrain, use noise functions like:
      // - Simplex noise
      // - Perlin noise
      // - Voronoi cells
      // - FBM (Fractal Brownian Motion)
    });
  }, [elevationUniforms]);

  // 4. Create position node for material
  const positionNode = useMemo(() => {
    if (!terrainMesh) {
      return Fn(() => vec3(0, 0, 0))();
    }
    return terrainMesh.positionNode();
  }, [terrainMesh]);

  // 5. Create color node using terrain data
  const colorNode = useMemo(() => {
    if (!terrainMesh) {
      return Fn(() => vec3(0, 0, 0))();
    }
    const height = varyings.vElevation
      .remap(0, elevationUniforms.uHeightmapScale.toVar(), 0, 1)
      .toColor();
    return terrainMesh.varyings.vNormal.toColor();
  }, [terrainMesh, varyings.vElevation, elevationUniforms.uHeightmapScale]);

  // 6. Create normal node for lighting
  const normalNode = useMemo(() => {
    if (!terrainMesh) {
      return Fn(() => vec3(0, 1, 0))();
    }
    return transformNormalToView(terrainMesh.varyings.vNormal);
  }, [terrainMesh]);

  // 7. Update terrain each frame
  useFrame(() => {
    if (terrainMesh) {
      // Update uniforms from controls
      elevationUniforms.uHeightmapScale.value = 1.0;
      elevationUniforms.uNoiseScale.value = 0.01;

      // Update terrain mesh instance-specific uniforms
      terrainMesh.uniforms.uSegments.value = 32;
      terrainMesh.uniforms.setSkirtHeight(1.0);
      terrainMesh.uniforms.setHeightmapScale(1.0);

      // Update quadtree configuration
      const qConfig = terrainMesh.quadtree.getConfig();
      qConfig.rootSize = 3200;
      qConfig.minNodeSize = 32;
      qConfig.subdivisionFactor = 2;
      qConfig.maxLevel = 10;

      // Create frustum for culling
      const frustum = new THREE.Frustum();
      const projScreenMatrix = new THREE.Matrix4();
      projScreenMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      );
      frustum.setFromProjectionMatrix(projScreenMatrix);

      // Update terrain (this triggers quadtree updates and compute shaders)
      terrainMesh.update(
        gl as unknown as THREE.WebGPURenderer,
        camera.position,
        frustum
      );
    }
  });

  return (
    <group>
      <hello.TerrainMesh
        receiveShadow
        castShadow
        frustumCulled={false}
        ref={(ref) => {
          if (ref) setTerrainMesh(ref);
        }}
        elevationFn={elevationFn}
        maxNodes={1000}
        rootSize={3200}
        innerTileSegments={32}
        subdivisionFactor={2}
        minNodeSize={32}
        maxLevel={10}
      >
        <meshStandardNodeMaterial
          name="TerrainMeshMaterial"
          positionNode={positionNode}
          colorNode={colorNode}
          normalNode={normalNode}
        />
      </hello.TerrainMesh>
    </group>
  );
};

// 8. Set up Canvas with WebGPU renderer
const Scene = () => {
  return (
    <Canvas
      gl={async (props) => {
        props.alpha = true;
        props.antialias = true;
        props.requiredLimits = {
          maxComputeWorkgroupsPerDimension: 65535,
          maxComputeWorkgroupSizeX: 1024,
          maxComputeWorkgroupSizeY: 1024,
          maxComputeWorkgroupSizeZ: 64,
        };
        const renderer = new THREE.WebGPURenderer(props);
        renderer.logarithmicDepthBuffer = true;
        await renderer.init();
        return renderer;
      }}
      camera={{
        near: 0.1,
        far: Number.MAX_SAFE_INTEGER,
        position: [3, 0, 3],
      }}
    >
      <TerrainPlane />
    </Canvas>
  );
};
```

### Key Concepts

#### TerrainMesh Parameters

- `elevationFn`: A function that calculates terrain height at any world position using TSL
- `maxNodes`: Maximum number of quadtree nodes (controls memory usage)
- `rootSize`: Size of the root terrain quad in world units
- `innerTileSegments`: Number of segments per tile edge (affects vertex density)
- `subdivisionFactor`: How much smaller each quadtree level is (typically 2)
- `minNodeSize`: Minimum size of a quadtree node before stopping subdivision
- `maxLevel`: Maximum depth of the quadtree

#### ElevationFn

The `ElevationFn` is a compute shader function that runs for every terrain vertex. It receives:
- `worldPosition`: The 3D world position where height should be calculated
- `rootUV`: UV coordinates relative to the root terrain
- `tileUV`: UV coordinates relative to the current tile
- `tileLevel`: Current quadtree level
- `tileSize`: Size of the current tile
- `tileOriginVec2`: Origin of the current tile
- `nodeIndex`: Index of the current quadtree node

#### Uniforms and Varyings

- **Uniforms**: Values shared across all instances (e.g., `elevationUniforms`)
- **Instance Uniforms**: Per-terrain-mesh uniforms accessed via `terrainMesh.uniforms`
- **Varyings**: Values passed from vertex to fragment shader (e.g., `vElevation`, `vNormal`)

#### Update Loop

The `terrainMesh.update()` method must be called each frame with:
- The WebGPU renderer
- Camera position (for LOD calculations)
- Camera frustum (for culling)

This triggers:
- Quadtree subdivision/merging based on camera distance
- Compute shader execution to generate heightmaps
- Normal map generation
- Instance buffer updates

### Advanced Features

- **Frustum Culling**: Automatically culls terrain tiles outside the camera view
- **Adaptive LOD**: Terrain detail increases near the camera automatically
- **Compute Shaders**: Height calculations run on GPU for performance
- **Instance Rendering**: All terrain tiles rendered as a single instanced mesh

## Development

### 1. Setup Environment

```bash
# Clone the repository
git clone <your-repo-url>
cd hello-terrain

# Install dependencies
pnpm install

# Create environment configuration
cp env.example .env
```

### 2. Configure Credentials

Edit the `.env` file with your actual credentials:
- AWS access keys
- Domain name (Route 53 hosted zone will be detected automatically)
- Pulumi access token

### 3. Deploy

```bash
# Deploy to development environment
./scripts/deploy-local.sh

# Or deploy to production via GitHub Actions
# (push to main branch)
```

## 📁 Project Structure

```
hello-terrain/
├── apps/
│   ├── docs/          # Vocs documentation
│   └── examples/      # React/Vite examples
├── packages/
│   ├── hello-terrain/
│   │   ├── react/     # React components
│   │   └── three/     # Three.js utilities
├── infrastructure/    # Pulumi infrastructure code
├── scripts/          # Deployment and setup scripts
└── .env              # Environment configuration (create this)
```



## 🌐 Deployment

The project is deployed to:
- **Main Site**: `https://hello-terrain.kenny.wtf`
- **Examples**: `https://hello-terrain.kenny.wtf/examples`

### Infrastructure

- **AWS S3**: Static file hosting
- **CloudFront**: CDN and caching
- **Route 53**: DNS management
- **ACM**: SSL certificate management
- **Pulumi**: Infrastructure as Code
- **Vocs**: React-based documentation framework

## 🛠️ Development

### Local Development

```bash
# Start docs development server
cd apps/docs
pnpm dev
```

### Building

```bash
# Build all packages
pnpm build

# Build specific apps
cd apps/docs && pnpm build
```

## 📚 Documentation

- [Deployment Guide](DEPLOYMENT.md) - Complete deployment instructions
- [Infrastructure README](infrastructure/README.md) - Infrastructure details

## 🔧 Scripts

- `./scripts/deploy-local.sh` - Deploy to development environment
