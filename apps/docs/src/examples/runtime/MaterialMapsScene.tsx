"use client";

import { Terrain, useTerrain, type TerrainNodes } from "@hello-terrain/react";
import {
  bindTerrainSource,
  createManagedTerrainTexture,
  createSourceMapping,
  terrainWeights,
  type ElevationCallback,
} from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { color } from "three/tsl";
import { DataTexture, LinearFilter, RepeatWrapping, RGBAFormat } from "three/webgpu";
import { ShowcaseButton, ShowcaseCanvas, ShowcaseLayout } from "./ShowcaseCanvas";

type PaintSource = ReturnType<typeof createManagedTerrainTexture>;
type MapReport = { name: string; geometry: number; appearance: number };

function fillWeights(data: Uint8Array, phase: number) {
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const weight = Math.round(
        (Math.sin((x / 64) * Math.PI * 4 + phase) * Math.cos((y / 64) * Math.PI * 2) * 0.5 + 0.5) *
          255,
      );
      const i = (y * 64 + x) * 4;
      data[i] = weight;
      data[i + 1] = 255 - weight;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
}

function MappedTerrain({
  source,
  index,
  onReport,
}: {
  source: PaintSource;
  index: number;
  onReport: (report: MapReport) => void;
}) {
  const elevation = useMemo<ElevationCallback>(
    () =>
      ({ worldPosition }) =>
        worldPosition.x.mul(0.08).sin().mul(worldPosition.z.mul(0.065).cos()),
    [],
  );
  const terrain = useTerrain({
    rootSize: 140,
    elevation,
    elevationRange: { min: -1, max: 1 },
    elevationScale: 14,
    maxNodes: 128,
    innerTileSegments: 21,
    maxLevel: 6,
    skirtScale: 8,
    cameraHysteresis: 0.1,
  });
  const mapping = useMemo(
    () => createSourceMapping({ scale: index === 0 ? [1, 1] : [3, 2], offset: [index * 0.2, 0] }),
    [index],
  );
  useEffect(
    () => bindTerrainSource(terrain.controller, source, ["appearance"]),
    [terrain.controller, source],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      const status = terrain.controller.getStatus();
      onReport({
        name: index === 0 ? "A" : "B",
        geometry: status.renderRevision?.editVersion ?? -1,
        appearance: status.presentationVersion,
      });
    }, 500);
    return () => clearInterval(timer);
  }, [terrain.controller, index, onReport]);
  return (
    <Terrain terrain={terrain} position={[index === 0 ? -85 : 85, 0, 0]}>
      {(nodes) => <MapMaterial {...nodes} source={source} mapping={mapping} />}
    </Terrain>
  );
}

function MapMaterial({
  positionNode,
  materialContext,
  source,
  mapping,
}: TerrainNodes & {
  source: PaintSource;
  mapping: ReturnType<typeof createSourceMapping>;
}) {
  const colorNode = useMemo(() => {
    if (!materialContext) return undefined;
    const weights = source.sample(mapping.uv(materialContext.sourceUV));
    const [grass, sand] = terrainWeights([weights.r, weights.g]);
    const painted = color("#257657").mul(grass!).add(color("#e7c88b").mul(sand!));
    return painted.mix(
      color("#59687d"),
      materialContext.slopeCosine.oneMinus().smoothstep(0.05, 0.3),
    );
  }, [materialContext, source, mapping]);
  return (
    <meshStandardNodeMaterial positionNode={positionNode} colorNode={colorNode} roughness={0.85} />
  );
}

export default function MaterialMapsScene() {
  const [source, setSource] = useState<PaintSource | null>(null);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reports, setReports] = useState<Record<string, MapReport>>({});
  const onReport = useMemo(
    () => (report: MapReport) => setReports((previous) => ({ ...previous, [report.name]: report })),
    [],
  );
  useEffect(() => {
    const data = new Uint8Array(64 * 64 * 4);
    fillWeights(data, 0);
    const texture = new DataTexture(data, 64, 64, RGBAFormat);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    const managed = createManagedTerrainTexture(texture);
    setSource(managed);
    return () => {
      managed.releaseSamplers();
      texture.dispose();
    };
  }, []);
  async function repaint() {
    if (!source) return;
    setPending(true);
    setError("");
    try {
      const next = version + 1;
      const receipt = await source.edit((texture) => {
        fillWeights((texture as DataTexture).image.data as Uint8Array, (next * Math.PI) / 3);
        texture.needsUpdate = true;
      });
      await receipt.retired;
      setVersion(receipt.version);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <ShowcaseLayout
      controls={
        <>
          <ShowcaseButton disabled={!source || pending} onClick={() => void repaint()}>
            Repaint shared map
          </ShowcaseButton>
          <p>
            The same two-channel weight map feeds both terrains. A uses 1 × 1 mapping; B uses 3 × 2.
            Grass and sand blend with a procedural rock slope mask.
          </p>
          <p role="status" data-map-status>
            Map edit {version} · {pending ? "applying…" : "ready"}
            {Object.values(reports)
              .map(
                (report) =>
                  ` · ${report.name}: geometry edit ${report.geometry}, appearance ${report.appearance}`,
              )
              .join("")}
          </p>
          <p className="text-fd-muted-foreground">
            Repainting advances appearance while the geometry edit stays unchanged. Orbiting can
            still update terrain LOD.
          </p>
          {error && <p role="alert">{error}</p>}
        </>
      }
    >
      <ShowcaseCanvas position={[240, 220, 300]}>
        {source && (
          <>
            <MappedTerrain source={source} index={0} onReport={onReport} />
            <MappedTerrain source={source} index={1} onReport={onReport} />
            <OrbitControls makeDefault target={[0, 0, 0]} minDistance={30} maxDistance={800} />
          </>
        )}
      </ShowcaseCanvas>
    </ShowcaseLayout>
  );
}
