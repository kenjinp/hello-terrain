"use client";

import { useExamplesCanvas } from "@/components/ExamplesCanvas";
import { Orbit, Plane } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

export type CameraMode = "orbit" | "fly";

/**
 * Overlay button (plus `V` hotkey) that switches between the orbit and fly
 * cameras. Rendered outside the R3F canvas, top-left under the ExamplesCanvas
 * chrome buttons. Like those buttons' hotkeys, `V` only fires while the
 * example container has focus (or is fullscreen), so scrolling the docs page
 * never toggles the camera.
 */
export function CameraModeToggle({
  mode,
  onChange,
}: {
  mode: CameraMode;
  onChange: (mode: CameraMode) => void;
}) {
  const { showUI, isFullscreen } = useExamplesCanvas();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggle = useCallback(
    () => onChange(mode === "orbit" ? "fly" : "orbit"),
    [mode, onChange],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== "v" && event.key !== "V") || event.repeat) return;
      // Same guard as the ExamplesCanvas chrome hotkeys: the container is the
      // nearest focusable ancestor of this button.
      const container = buttonRef.current?.closest<HTMLElement>('[tabindex="0"]');
      const focusInside = container?.contains(document.activeElement) ?? false;
      if (!focusInside && !isFullscreen) return;
      event.preventDefault();
      toggle();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, toggle]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      className={`cursor-pointer flex items-center gap-1.5 p-1.5 md:p-2 rounded-md md:rounded-lg bg-black/50 hover:bg-black/70 text-white text-xs transition-all backdrop-blur-sm border border-white/10 ${
        showUI ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      aria-label={`Switch to ${mode === "orbit" ? "fly" : "orbit"} camera`}
      title={`Switch to ${mode === "orbit" ? "fly" : "orbit"} camera (V)`}
    >
      {mode === "orbit" ? (
        <Orbit className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
      ) : (
        <Plane className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
      )}
      <span className="capitalize">{mode}</span>
      <kbd className="rounded border border-white/20 bg-white/10 px-1 text-[10px] text-white/70">
        V
      </kbd>
    </button>
  );
}
