"use client";

import type { BrushSettings as BrushSettingsType } from "./usePaintingState";

export interface BrushSettingsProps {
  /** Current brush settings */
  settings: BrushSettingsType;
  /** Callback when radius changes */
  onRadiusChange: (radius: number) => void;
  /** Callback when softness changes */
  onSoftnessChange: (softness: number) => void;
  /** Callback when strength changes */
  onStrengthChange: (strength: number) => void;
}

/**
 * Slider component for brush settings
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}) {
  const displayValue = formatValue ? formatValue(value) : value.toString();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <label className="text-white/80 text-sm">{label}</label>
        <span className="text-white/60 text-xs font-mono bg-white/10 px-1.5 py-0.5 rounded">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-400
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:bg-blue-400
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:shadow-md
          [&::-webkit-slider-thumb]:hover:bg-blue-300
          [&::-moz-range-thumb]:w-4
          [&::-moz-range-thumb]:h-4
          [&::-moz-range-thumb]:bg-blue-400
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:cursor-pointer
          [&::-moz-range-thumb]:border-0"
      />
    </div>
  );
}

/**
 * BrushSettings component
 *
 * Provides sliders for adjusting brush radius, softness, and strength.
 * Uses a dark glass styling to match the documentation app's overlay panels.
 */
export function BrushSettings({
  settings,
  onRadiusChange,
  onSoftnessChange,
  onStrengthChange,
}: BrushSettingsProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-white/90 font-semibold text-sm border-b border-white/10 pb-1">
        Brush Settings
      </h3>

      <Slider
        label="Radius"
        value={settings.radius}
        min={5}
        max={200}
        step={1}
        onChange={onRadiusChange}
        formatValue={(v) => `${v}m`}
      />

      <Slider
        label="Softness"
        value={settings.softness}
        min={0}
        max={1}
        step={0.05}
        onChange={onSoftnessChange}
        formatValue={(v) => `${Math.round(v * 100)}%`}
      />

      <Slider
        label="Strength"
        value={settings.strength}
        min={0}
        max={1}
        step={0.05}
        onChange={onStrengthChange}
        formatValue={(v) => `${Math.round(v * 100)}%`}
      />
    </div>
  );
}
