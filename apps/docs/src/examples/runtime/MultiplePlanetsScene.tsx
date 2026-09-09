"use client";

import { Terrain, useTerrain, type TerrainHandle, type TerrainNodes } from "@hello-terrain/react";
import { createCubeSphereTopology, type ElevationCallback } from "@hello-terrain/three";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { color } from "three/tsl";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ShowcaseButton, ShowcaseCanvas, ShowcaseLayout } from "./ShowcaseCanvas";

type Planet = { name: string; radius: number; position: [number, number, number]; tint: string };
type Report = { name: string; render: number; query: number; elevation: string; error: string };

function PlanetTerrain({
  planet,
  relief,
  onReport,
}: {
  planet: Planet;
  relief: number;
  onReport: (report: Report) => void;
}) {
  const topology = useMemo(
    () => createCubeSphereTopology({ radius: planet.radius }),
    [planet.radius],
  );
  // The callback is ordinary TSL, expressed in dimensionless datum coordinates.
  const elevation = useMemo<ElevationCallback>(
    () =>
      ({ worldPosition }) => {
        const p = worldPosition.div(planet.radius);
        return p.x.mul(11).sin().mul(p.y.mul(7).cos()).mul(p.z.mul(9).add(1).sin());
      },
    [planet.radius],
  );
  const terrain = useTerrain({
    topology,
    elevation,
    elevationRange: { min: -1, max: 1 },
    elevationScale: relief,
    innerTileSegments: 21,
    maxNodes: 384,
    maxLevel: 18,
    skirtScale: 300,
    cameraHysteresis: 1,
  });
  const latest = useRef<TerrainHandle>(terrain);
  latest.current = terrain;
  useEffect(() => {
    const report = () => {
      const handle = latest.current;
      const sample = handle.binding?.sampleWorld([
        planet.position[0] + planet.radius * 0.4,
        planet.position[1] + planet.radius * 0.2,
        planet.position[2] + planet.radius * Math.sqrt(0.8),
      ]);
      onReport({
        name: planet.name,
        render: handle.status.renderRevision?.editVersion ?? -1,
        query: handle.status.queryRevision?.editVersion ?? -1,
        elevation:
          sample?.status === "available"
            ? `${sample.elevation.toFixed(1)} m`
            : (sample?.reason ?? "waiting"),
        error: handle.status.lastError ? String(handle.status.lastError) : "",
      });
    };
    const timer = setInterval(report, 500);
    report();
    return () => clearInterval(timer);
  }, [planet, onReport]);
  return (
    <Terrain terrain={terrain} position={planet.position}>
      {(nodes) => <PlanetMaterial {...nodes} relief={relief} tint={planet.tint} />}
    </Terrain>
  );
}

function PlanetMaterial({
  positionNode,
  materialContext,
  relief,
  tint,
}: TerrainNodes & { relief: number; tint: string }) {
  const colorNode = useMemo(
    () =>
      materialContext
        ? color("#15263d").mix(
            color(tint),
            materialContext.elevation.div(Math.max(relief, 1)).smoothstep(-0.3, 0.65),
          )
        : undefined,
    [materialContext, relief, tint],
  );
  return (
    <meshStandardNodeMaterial positionNode={positionNode} colorNode={colorNode} roughness={0.85} />
  );
}

function PlanetCamera({ planets, focus }: { planets: Planet[]; focus: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  useEffect(() => {
    const target = focus < 0 ? planets[0]!.position : planets[focus]!.position;
    const distance = focus < 0 ? 34_000_000 : planets[focus]!.radius * 2.8;
    camera.position.set(
      target[0] + distance * 0.25,
      target[1] + distance * 0.35,
      target[2] + distance,
    );
    camera.lookAt(...target);
    controls.current?.target.set(...target);
    controls.current?.update();
  }, [camera, focus, planets]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      minDistance={100}
      maxDistance={150_000_000}
    />
  );
}

export default function MultiplePlanetsScene() {
  const planets = useMemo<Planet[]>(
    () => [
      { name: "Pelagos", radius: 6_371_007.2, position: [1_000_000_000, 0, 0], tint: "#74c7a1" },
      {
        name: "Ember",
        radius: 3_390_000,
        position: [1_015_000_000, 1_500_000, -3_000_000],
        tint: "#ef9c65",
      },
      {
        name: "Selene",
        radius: 1_737_400,
        position: [989_000_000, -1_000_000, 2_000_000],
        tint: "#c6c4ed",
      },
    ],
    [],
  );
  const [focus, setFocus] = useState(-1);
  const [relief, setRelief] = useState([120_000, 90_000, 35_000]);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const onReport = useMemo(
    () => (report: Report) => setReports((previous) => ({ ...previous, [report.name]: report })),
    [],
  );
  return (
    <ShowcaseLayout
      controls={
        <>
          <div className="flex flex-wrap gap-2">
            <ShowcaseButton active={focus === -1} onClick={() => setFocus(-1)}>
              Whole system
            </ShowcaseButton>
            {planets.map((planet, index) => (
              <ShowcaseButton
                key={planet.name}
                active={focus === index}
                onClick={() => setFocus(index)}
              >
                {planet.name}
              </ShowcaseButton>
            ))}
          </div>
          <p>
            Three independent worlds, placed one billion metres from the scene origin. Drag to
            orbit; scroll to zoom. Relief is exaggerated for visibility.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {planets.map((planet, index) => (
              <div key={planet.name} className="space-y-1">
                <label className="block">
                  {planet.name} relief · {Math.round(relief[index]! / 1000)} km
                  <input
                    className="block w-full"
                    aria-label={`${planet.name} relief`}
                    type="range"
                    min={0}
                    max={250000}
                    step={5000}
                    value={relief[index]}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setRelief((previous) =>
                        previous.map((old, i) => (i === index ? value : old)),
                      );
                    }}
                  />
                </label>
                <p className="text-xs text-fd-muted-foreground" data-planet-status={planet.name}>
                  Render edit {reports[planet.name]?.render ?? "…"} · query edit{" "}
                  {reports[planet.name]?.query ?? "…"}
                  <br />
                  Surface probe: {reports[planet.name]?.elevation ?? "waiting"}
                </p>
                {reports[planet.name]?.error && <p role="alert">{reports[planet.name]?.error}</p>}
              </div>
            ))}
          </div>
        </>
      }
    >
      <ShowcaseCanvas position={[1_008_500_000, 11_900_000, 34_000_000]} far={250_000_000}>
        <directionalLight position={[1_020_000_000, 30_000_000, 30_000_000]} intensity={1.5} />
        {planets.map((planet, index) => (
          <PlanetTerrain
            key={planet.name}
            planet={planet}
            relief={relief[index]!}
            onReport={onReport}
          />
        ))}
        <PlanetCamera planets={planets} focus={focus} />
      </ShowcaseCanvas>
    </ShowcaseLayout>
  );
}
