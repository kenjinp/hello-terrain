import type { CSSProperties, ReactNode } from "react";

/**
 * Shared styling tokens and primitives for the debug overlay HUDs rendered on
 * top of example scenes (FpsDebug, TerrainTileDebug, RunTimingBars,
 * TerrainFieldTextureDebug).
 *
 * Centralizing these keeps the font, sizes, and chrome consistent across every
 * overlay so they read as a single, cohesive debug UI.
 *
 * Panel text is rendered as real HTML (px-based) rather than SVG `<text>`.
 * SVG `<text>` inside a `w-full` viewBox scales with the panel width, so the
 * same `fontSize` renders at wildly different pixel sizes depending on each
 * panel's viewBox width. HTML keeps every overlay's typography identical.
 */

/** Monospace font stack used by every debug overlay. */
export const DEBUG_MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/** Chrome (background, border, blur, radius) shared by every overlay surface. */
const DEBUG_SURFACE =
  "select-none bg-black/45 border border-white/10 backdrop-blur-sm rounded-md";

/** Base class for inline overlays that flow within the bottom HUD stack. */
export const DEBUG_PANEL_INLINE = `w-full ${DEBUG_SURFACE} px-2 py-1.5 transition-opacity duration-200`;

/** Base class for floating/draggable overlays positioned via fixed coordinates. */
export const DEBUG_PANEL_FLOATING = `fixed z-40 pointer-events-auto ${DEBUG_SURFACE} p-2`;

/** Tailwind class for the standard HTML text size used across overlays. */
export const DEBUG_TEXT_SIZE = "text-[10px]";

/** Smaller text size for dense inline annotations (eg. timing bar segments). */
export const DEBUG_TEXT_SIZE_SM = "text-[8px]";

/** Shared label/value muting used by stat rows. */
export const DEBUG_LABEL_CLASS = "text-white/50";
export const DEBUG_VALUE_CLASS = "text-white/85";

export type DebugRow = {
  label: ReactNode;
  value: ReactNode;
  /** Optional explicit value color (eg. FPS health). Overrides DEBUG_VALUE_CLASS. */
  valueColor?: string;
};

/**
 * A monospace stack of `label … value` rows shared by the textual overlays.
 * Uses HTML so the font renders at a consistent pixel size in every panel.
 */
export function DebugStatRows({
  rows,
  className,
}: {
  rows: DebugRow[];
  className?: string;
}) {
  return (
    <div
      className={`${DEBUG_TEXT_SIZE} leading-4 ${className ?? ""}`}
      style={{ fontFamily: DEBUG_MONO_FONT }}
    >
      {rows.map((row, i) => {
        const valueStyle: CSSProperties | undefined = row.valueColor
          ? { color: row.valueColor }
          : undefined;
        return (
          <div
            key={i}
            className="flex items-baseline justify-between gap-3 tabular-nums"
          >
            <span className={DEBUG_LABEL_CLASS}>{row.label}</span>
            <span
              className={row.valueColor ? undefined : DEBUG_VALUE_CLASS}
              style={valueStyle}
            >
              {row.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
