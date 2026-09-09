"use client";

import { Terrain, useTerrain, type TerrainNodes } from "@hello-terrain/react";
import type { ElevationCallback } from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { color } from "three/tsl";
import { ShowcaseButton, ShowcaseCanvas, ShowcaseLayout } from "./ShowcaseCanvas";

type EditCommand = { serial: number; scale: number };
type EditReport = { pending: boolean; message: string };

function EditingTerrain({
  command,
  onReport,
}: {
  command: EditCommand;
  onReport: (report: EditReport) => void;
}) {
  const elevation = useMemo<ElevationCallback>(
    () =>
      ({ worldPosition }) =>
        worldPosition.x.mul(0.065).sin().mul(worldPosition.z.mul(0.045).cos()).mul(0.5).add(0.5),
    [],
  );
  const terrain = useTerrain({
    rootSize: 240,
    elevation,
    elevationRange: { min: 0, max: 1 },
    elevationScale: 25,
    innerTileSegments: 21,
    maxNodes: 192,
    maxLevel: 7,
    skirtScale: 10,
    cameraHysteresis: 0.1,
  });
  const [markers, setMarkers] = useState<[number, number, number][]>([]);
  const { controller } = terrain;
  useEffect(() => {
    const abort = new AbortController();
    async function apply() {
      onReport({
        pending: true,
        message: "Waiting for the accepted edit to reach the CPU snapshot…",
      });
      try {
        const edit = controller.configure({ elevationScale: command.scale });
        await controller.requestSnapshot({ minEditVersion: edit, signal: abort.signal });
        if (abort.signal.aborted) return;
        // A lease gives all markers one coherent snapshot, then releases it.
        const lease = controller.query.acquireSnapshot();
        if (!lease) throw new Error("Snapshot unavailable");
        try {
          const points = new Float64Array([-60, 0, -30, -20, 0, 10, 20, 0, -10, 60, 0, 30]);
          const samples = lease.sampleBatch(points);
          const next: [number, number, number][] = [];
          for (let i = 0; i < samples.valid.length; i++) {
            if (samples.valid[i])
              next.push([
                samples.positions[i * 3]!,
                samples.positions[i * 3 + 1]! + 3,
                samples.positions[i * 3 + 2]!,
              ]);
          }
          setMarkers(next);
          onReport({
            pending: false,
            message: `Accepted edit ${edit} · snapshot edit ${lease.revision.editVersion} · ${next.length}/4 probes placed`,
          });
        } finally {
          lease.release();
        }
      } catch (error) {
        if (!abort.signal.aborted)
          onReport({ pending: false, message: `Edit failed: ${String(error)}` });
      }
    }
    void apply();
    return () => abort.abort();
  }, [controller, command, onReport]);
  return (
    <>
      <Terrain terrain={terrain}>{(nodes) => <EditingMaterial {...nodes} />}</Terrain>
      {markers.map((position, index) => (
        <mesh key={index} position={position}>
          <sphereGeometry args={[3, 16, 12]} />
          <meshBasicMaterial color="#ffdb6e" />
        </mesh>
      ))}
      <OrbitControls makeDefault target={[0, 10, 0]} minDistance={20} maxDistance={650} />
    </>
  );
}

function EditingMaterial({ positionNode, materialContext }: TerrainNodes) {
  const colorNode = useMemo(
    () =>
      materialContext
        ? color("#267e8a").mix(color("#e6c98d"), materialContext.elevation.div(75).clamp())
        : undefined,
    [materialContext],
  );
  return (
    <meshStandardNodeMaterial positionNode={positionNode} colorNode={colorNode} roughness={0.9} />
  );
}

export default function RuntimeEditingScene() {
  const [scale, setScale] = useState(25);
  const [command, setCommand] = useState<EditCommand>({ serial: 0, scale: 25 });
  const [report, setReport] = useState<EditReport>({
    pending: true,
    message: "Preparing terrain…",
  });
  return (
    <ShowcaseLayout
      controls={
        <>
          <label className="block">
            Elevation scale · {scale} m
            <input
              className="ml-3 align-middle"
              aria-label="Elevation scale"
              type="range"
              min={0}
              max={75}
              step={5}
              value={scale}
              onChange={(event) => setScale(Number(event.target.value))}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <ShowcaseButton
              disabled={report.pending}
              onClick={() => setCommand((previous) => ({ serial: previous.serial + 1, scale }))}
            >
              Apply elevation
            </ShowcaseButton>
            <ShowcaseButton
              disabled={report.pending}
              onClick={() => {
                setScale(0);
                setCommand((previous) => ({ serial: previous.serial + 1, scale: 0 }));
              }}
            >
              Flatten terrain
            </ShowcaseButton>
          </div>
          <p>
            Keep the camera still and apply an edit. Gold probes move together after a matching CPU
            snapshot is available. Zero elevation is valid terrain.
          </p>
          <p role="status" data-edit-status>
            {report.message}
          </p>
        </>
      }
    >
      <ShowcaseCanvas position={[210, 180, 230]}>
        <EditingTerrain command={command} onReport={setReport} />
      </ShowcaseCanvas>
    </ShowcaseLayout>
  );
}
