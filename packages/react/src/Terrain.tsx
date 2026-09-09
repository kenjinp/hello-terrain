import { createTerrainBinding, type TerrainBinding } from '@hello-terrain/three';
import { useFrame } from '@react-three/fiber';
import { cloneElement, isValidElement, useEffect, useState, useRef } from 'react';
import { TerrainProvider } from './TerrainContext';
import type {
    TerrainHandle,
    TerrainPrimitiveProps,
    TerrainProps,
    TerrainPropsWithoutHandle,
    TerrainRenderProps,
} from './types';
import { useTerrain } from './useTerrain';

function attachTerrainMaterial(node: ReturnType<TerrainRenderProps['children']>) {
    if (!isValidElement<{ attach?: unknown }>(node)) return node;

    if ('attach' in node.props && node.props.attach != null) {
        return node;
    }
    return cloneElement(node, { attach: 'material' });
}

function TerrainWithHandle({
    terrain,
    children,
    ...primitiveProps
}: {
    terrain: TerrainHandle;
    children: TerrainRenderProps['children'];
} & TerrainPrimitiveProps) {
    const latestTerrain = useRef(terrain);
    latestTerrain.current = terrain;
    const [binding, setBinding] = useState<TerrainBinding | null>(null);
    useEffect(() => {
        const binding = createTerrainBinding(terrain.controller, { externalMaterialAttachment: true });
        setBinding(binding);
        latestTerrain.current.binding = binding;
        return () => {
            if (latestTerrain.current.binding === binding) latestTerrain.current.binding = null;
            void binding.dispose();
        };
    }, [terrain.controller]);
    const { visible: primitiveVisible = true, ...restPrimitiveProps } = primitiveProps;

    useFrame(() => {
        if (binding) binding.mesh.terrainRaycast = terrain.runtime.raycast;
    });

    if (!binding) return null;
    const mesh = binding.mesh;
    return (
        <TerrainProvider value={terrain}>
            <primitive
                object={mesh}
                visible={terrain.ready && primitiveVisible}
                {...restPrimitiveProps}
            >
                {terrain.ready
                    ? attachTerrainMaterial(
                          children({
                              positionNode: terrain.positionNode,
                              materialContext: terrain.materialContext,
                          })
                      )
                    : null}
            </primitive>
        </TerrainProvider>
    );
}

function InternalTerrain(props: TerrainPropsWithoutHandle) {
    const {
        children,
        rootSize,
        origin,
        maxLevel,
        innerTileSegments,
        skirtScale,
        elevationScale,
        elevation,
        elevationRange,
        lod,
        queries,
        topology,
        terrainFieldFilter,
        terrainFieldFormat,
        getCameraOrigin,
        cameraHysteresis,
        maxNodes,
        ...primitiveProps
    } = props;

    const terrain = useTerrain({
        rootSize,
        origin,
        maxLevel,
        innerTileSegments,
        skirtScale,
        elevationScale,
        elevation,
        elevationRange,
        lod,
        queries,
        topology,
        terrainFieldFilter,
        terrainFieldFormat,
        getCameraOrigin,
        cameraHysteresis,
        maxNodes,
    });

    return (
        <TerrainWithHandle terrain={terrain} {...primitiveProps}>
            {children}
        </TerrainWithHandle>
    );
}

export function Terrain(props: TerrainProps) {
    const { terrain: providedTerrain, children } = props;

    if (providedTerrain) {
        const { terrain: _terrain, children: _children, ...primitiveProps } = props;
        return (
            <TerrainWithHandle terrain={providedTerrain} {...primitiveProps}>
                {children}
            </TerrainWithHandle>
        );
    }

    const {
        rootSize,
        origin,
        maxLevel,
        innerTileSegments,
        skirtScale,
        elevationScale,
        elevation,
        elevationRange,
        lod,
        queries,
        topology,
        terrainFieldFilter,
        terrainFieldFormat,
        getCameraOrigin,
        cameraHysteresis,
        maxNodes,
        ...primitiveProps
    } = props;

    return (
        <InternalTerrain
            rootSize={rootSize}
            origin={origin}
            maxLevel={maxLevel}
            innerTileSegments={innerTileSegments}
            skirtScale={skirtScale}
            elevationScale={elevationScale}
            elevation={elevation}
            elevationRange={elevationRange}
            lod={lod}
            queries={queries}
            topology={topology}
            terrainFieldFilter={terrainFieldFilter}
            terrainFieldFormat={terrainFieldFormat}
            getCameraOrigin={getCameraOrigin}
            cameraHysteresis={cameraHysteresis}
            maxNodes={maxNodes}
            {...primitiveProps}
        >
            {children}
        </InternalTerrain>
    );
}
