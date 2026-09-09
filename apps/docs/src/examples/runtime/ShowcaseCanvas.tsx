"use client";

import { Canvas, extend, type CanvasProps } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import type { WebGPURendererParameters } from "three/src/renderers/webgpu/WebGPURenderer.js";

extend({ MeshStandardNodeMaterial });

export function ShowcaseCanvas({
  children,
  position,
  far = 2000,
}: {
  children: ReactNode;
  position: [number, number, number];
  far?: number;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  // Fiber can configure again while async initialization is still pending.
  // Reuse that promise for this canvas instead of constructing another renderer.
  const initialization = useRef<{ canvas: unknown; promise: Promise<WebGPURenderer> } | null>(null);
  const createRenderer = useCallback<Extract<CanvasProps["gl"], (props: never) => unknown>>(
    (props) => {
      if (initialization.current && initialization.current.canvas === props.canvas)
        return initialization.current.promise;
      const renderer = new WebGPURenderer({
        ...props,
        antialias: true,
      } as WebGPURendererParameters);
      renderer.logarithmicDepthBuffer = true;
      const promise = renderer
        .init()
        .then(() => renderer)
        .catch((cause) => {
          setError(`WebGPU initialization failed: ${String(cause)}`);
          throw cause;
        });
      initialization.current = { canvas: props.canvas, promise };
      return promise;
    },
    [],
  );
  useEffect(() => {
    setSupported("gpu" in navigator);
  }, []);
  if (supported === null) return <p className="p-6">Preparing scene…</p>;
  if (!supported || error)
    return (
      <p role="alert" className="p-6">
        {error || "This example needs a browser with WebGPU enabled."}
      </p>
    );
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position, fov: 45, near: 0.1, far }} gl={createRenderer}>
      <color attach="background" args={["#080f1b"]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[8, 12, 10]} intensity={2.6} />
      {children}
    </Canvas>
  );
}

export function ShowcaseLayout({
  children,
  controls,
}: {
  children: ReactNode;
  controls: ReactNode;
}) {
  return (
    <div className="not-prose overflow-hidden rounded-xl border border-fd-border bg-[#080f1b]">
      <div className="h-[460px] sm:h-[560px]" data-showcase-canvas>
        {children}
      </div>
      <div
        className="space-y-3 border-t border-fd-border bg-fd-card p-4 text-sm"
        data-showcase-controls
      >
        {controls}
      </div>
    </div>
  );
}

export function ShowcaseButton({
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className="rounded-md border border-fd-border px-3 py-2 hover:bg-fd-accent aria-pressed:bg-fd-accent disabled:opacity-40"
    >
      {children}
    </button>
  );
}
