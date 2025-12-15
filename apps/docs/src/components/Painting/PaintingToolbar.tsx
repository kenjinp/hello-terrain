"use client";

import { useState } from "react";
import { BrushSettings } from "./BrushSettings";
import { PaintModeSelector } from "./PaintModeSelector";
import { TexturePalette } from "./TexturePalette";
import { PAINT_MODE } from "./createPaintableTerrainColorNode";
import type { PaintingActions, PaintingState } from "./usePaintingState";

export interface PaintingToolbarProps {
  /** Current painting state */
  state: PaintingState;
  /** Painting actions to update state */
  actions: PaintingActions;
  /** Optional className for positioning */
  className?: string;
}

/**
 * PaintingToolbar component
 *
 * Main container panel that combines all painting controls:
 * - Paint mode selector (base/overlay/blend/heightmap)
 * - Texture palette for selecting textures
 * - Brush settings (radius, softness, strength)
 *
 * Uses dark glass styling with backdrop blur to match the documentation app's
 * overlay aesthetic.
 *
 * @example
 * ```tsx
 * const { state, actions } = usePaintingState();
 *
 * return (
 *   <div className="relative w-full h-full">
 *     <Canvas>...</Canvas>
 *     <PaintingToolbar
 *       state={state}
 *       actions={actions}
 *       className="absolute top-4 left-4"
 *     />
 *   </div>
 * );
 * ```
 */
export function PaintingToolbar({
  state,
  actions,
  className = "",
}: PaintingToolbarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Only show texture palette for texture-related modes
  const showTexturePalette =
    state.mode === PAINT_MODE.BASE_TEXTURE ||
    state.mode === PAINT_MODE.OVERLAY_TEXTURE;

  return (
    <div
      className={`
        bg-black/70 backdrop-blur-sm border border-white/20 rounded-lg
        shadow-lg max-w-[280px] select-none
        ${className}
      `}
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          {/* Paint brush icon */}
          <svg
            className="w-5 h-5 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
          <span className="text-white font-semibold">Terrain Painter</span>
        </div>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          aria-label={collapsed ? "Expand toolbar" : "Collapse toolbar"}
        >
          <svg
            className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="p-3 space-y-4">
          {/* Paint Mode */}
          <PaintModeSelector
            selectedMode={state.mode}
            onModeChange={actions.setMode}
          />

          {/* Texture Palette (only for texture modes) */}
          {showTexturePalette && (
            <TexturePalette
              selectedId={state.selectedTextureId}
              onSelect={actions.setSelectedTexture}
            />
          )}

          {/* Brush Settings */}
          <BrushSettings
            settings={state.brush}
            onRadiusChange={actions.setBrushRadius}
            onSoftnessChange={actions.setBrushSoftness}
            onStrengthChange={actions.setBrushStrength}
          />

          {/* Painting status indicator */}
          {state.isPainting && (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span>Painting...</span>
            </div>
          )}
        </div>
      )}

      {/* Keyboard hints */}
      {!collapsed && (
        <div className="px-3 py-2 border-t border-white/10 text-white/40 text-xs space-y-0.5">
          <div>
            <span className="font-mono">[</span> /{" "}
            <span className="font-mono">]</span> Brush size
          </div>
          <div>Left-click to paint | Right-click to rotate</div>
        </div>
      )}
    </div>
  );
}
