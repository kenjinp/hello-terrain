"use client";

import { PAINT_MODE, type PaintMode } from "./createPaintableTerrainColorNode";
import { getPaintModeName } from "./usePaintingState";

export interface PaintModeSelectorProps {
  /** Currently selected paint mode */
  selectedMode: PaintMode;
  /** Callback when mode changes */
  onModeChange: (mode: PaintMode) => void;
}

/** Paint modes available for selection */
const AVAILABLE_MODES: PaintMode[] = [
  PAINT_MODE.BASE_TEXTURE,
  PAINT_MODE.OVERLAY_TEXTURE,
  PAINT_MODE.BLEND,
  PAINT_MODE.HEIGHTMAP_RAISE,
  PAINT_MODE.HEIGHTMAP_LOWER,
];

/** Icons for each paint mode */
function getModeIcon(mode: PaintMode): React.ReactNode {
  switch (mode) {
    case PAINT_MODE.BASE_TEXTURE:
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      );
    case PAINT_MODE.OVERLAY_TEXTURE:
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case PAINT_MODE.BLEND:
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
      );
    case PAINT_MODE.HEIGHTMAP_RAISE:
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 10l7-7m0 0l7 7m-7-7v18"
          />
        </svg>
      );
    case PAINT_MODE.HEIGHTMAP_LOWER:
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          />
        </svg>
      );
    default:
      return null;
  }
}

/** Get short label for a mode */
function getShortLabel(mode: PaintMode): string {
  switch (mode) {
    case PAINT_MODE.BASE_TEXTURE:
      return "Base";
    case PAINT_MODE.OVERLAY_TEXTURE:
      return "Overlay";
    case PAINT_MODE.BLEND:
      return "Blend";
    case PAINT_MODE.HEIGHTMAP_RAISE:
      return "Raise";
    case PAINT_MODE.HEIGHTMAP_LOWER:
      return "Lower";
    default:
      return "???";
  }
}

/**
 * PaintModeSelector component
 *
 * Provides buttons to switch between different paint modes:
 * - Base Texture: Paint the primary/base texture layer
 * - Overlay Texture: Paint the overlay texture layer
 * - Blend: Adjust the blend factor between base and overlay
 * - Raise/Lower Terrain: Modify the heightmap
 */
export function PaintModeSelector({
  selectedMode,
  onModeChange,
}: PaintModeSelectorProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-white/90 font-semibold text-sm border-b border-white/10 pb-1">
        Paint Mode
      </h3>

      <div className="grid grid-cols-2 gap-1.5">
        {AVAILABLE_MODES.map((mode) => {
          const isSelected = mode === selectedMode;
          const isHeightMode =
            mode === PAINT_MODE.HEIGHTMAP_RAISE ||
            mode === PAINT_MODE.HEIGHTMAP_LOWER;

          return (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              className={`
                flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium
                transition-all duration-150 cursor-pointer
                ${
                  isSelected
                    ? isHeightMode
                      ? "bg-orange-500/40 ring-1 ring-orange-400 text-white"
                      : "bg-blue-500/40 ring-1 ring-blue-400 text-white"
                    : "bg-white/10 hover:bg-white/20 text-white/80"
                }
              `}
              title={getPaintModeName(mode)}
            >
              {getModeIcon(mode)}
              <span>{getShortLabel(mode)}</span>
            </button>
          );
        })}
      </div>

      {/* Mode description */}
      <p className="text-white/50 text-xs italic">
        {selectedMode === PAINT_MODE.BASE_TEXTURE &&
          "Paint the primary terrain texture"}
        {selectedMode === PAINT_MODE.OVERLAY_TEXTURE &&
          "Paint the secondary overlay texture"}
        {selectedMode === PAINT_MODE.BLEND &&
          "Adjust blend between base and overlay"}
        {selectedMode === PAINT_MODE.HEIGHTMAP_RAISE && "Raise terrain height"}
        {selectedMode === PAINT_MODE.HEIGHTMAP_LOWER && "Lower terrain height"}
      </p>
    </div>
  );
}
