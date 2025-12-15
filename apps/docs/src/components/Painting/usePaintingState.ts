"use client";

import { useCallback, useState } from "react";
import { PAINT_MODE, type PaintMode } from "./createPaintableTerrainColorNode";

/**
 * Available terrain textures
 */
export const TERRAIN_TEXTURES = [
  { id: 0, name: "Grass", path: "/assets/terrain-textures/grass/grass" },
  { id: 1, name: "Rock", path: "/assets/terrain-textures/rock/rock" },
  { id: 2, name: "Slate", path: "/assets/terrain-textures/slate/slate" },
  { id: 3, name: "Snow", path: "/assets/terrain-textures/snow/snow" },
  { id: 4, name: "Mud", path: "/assets/terrain-textures/mud/mud" },
  { id: 5, name: "Sand", path: "/assets/terrain-textures/sand/wavy-sand" },
] as const;

export type TerrainTextureId = (typeof TERRAIN_TEXTURES)[number]["id"];

/**
 * Brush settings state
 */
export interface BrushSettings {
  /** Brush radius in world units */
  radius: number;
  /** Brush softness (0 = hard edge, 1 = soft gaussian) */
  softness: number;
  /** Brush strength/opacity (0-1) */
  strength: number;
}

/**
 * Complete painting state
 */
export interface PaintingState {
  /** Current paint mode */
  mode: PaintMode;
  /** Selected texture ID for painting */
  selectedTextureId: TerrainTextureId;
  /** Brush settings */
  brush: BrushSettings;
  /** Whether painting is currently active (mouse down) */
  isPainting: boolean;
}

/**
 * Actions for updating painting state
 */
export interface PaintingActions {
  /** Set the paint mode */
  setMode: (mode: PaintMode) => void;
  /** Set the selected texture ID */
  setSelectedTexture: (id: TerrainTextureId) => void;
  /** Set brush radius */
  setBrushRadius: (radius: number) => void;
  /** Set brush softness */
  setBrushSoftness: (softness: number) => void;
  /** Set brush strength */
  setBrushStrength: (strength: number) => void;
  /** Set whether painting is active */
  setIsPainting: (isPainting: boolean) => void;
  /** Update all brush settings at once */
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
}

/**
 * Default painting state values
 */
export const DEFAULT_PAINTING_STATE: PaintingState = {
  mode: PAINT_MODE.BASE_TEXTURE,
  selectedTextureId: 0,
  brush: {
    radius: 50,
    softness: 0.5,
    strength: 1.0,
  },
  isPainting: false,
};

/**
 * Hook for managing terrain painting state
 *
 * Provides centralized state management for brush settings, texture selection,
 * and paint mode. Use this hook in your scene component and pass the state
 * to both the UI components and the brush uniforms.
 *
 * @example
 * ```tsx
 * function TerrainPaintingScene() {
 *   const { state, actions } = usePaintingState();
 *
 *   // Sync state with brush uniforms in useFrame
 *   useFrame(() => {
 *     brushUniforms.brushRadius.value = state.brush.radius;
 *     brushUniforms.brushSoftness.value = state.brush.softness;
 *     brushUniforms.brushStrength.value = state.brush.strength;
 *     brushUniforms.previewTextureId.value = state.selectedTextureId;
 *     brushUniforms.previewMode.value = state.mode;
 *   });
 *
 *   return (
 *     <>
 *       <PaintingToolbar state={state} actions={actions} />
 *       <Canvas>...</Canvas>
 *     </>
 *   );
 * }
 * ```
 */
export function usePaintingState(initialState: Partial<PaintingState> = {}): {
  state: PaintingState;
  actions: PaintingActions;
} {
  const [state, setState] = useState<PaintingState>({
    ...DEFAULT_PAINTING_STATE,
    ...initialState,
    brush: {
      ...DEFAULT_PAINTING_STATE.brush,
      ...initialState.brush,
    },
  });

  const setMode = useCallback((mode: PaintMode) => {
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const setSelectedTexture = useCallback((id: TerrainTextureId) => {
    setState((prev) => ({ ...prev, selectedTextureId: id }));
  }, []);

  const setBrushRadius = useCallback((radius: number) => {
    setState((prev) => ({
      ...prev,
      brush: { ...prev.brush, radius: Math.max(5, Math.min(500, radius)) },
    }));
  }, []);

  const setBrushSoftness = useCallback((softness: number) => {
    setState((prev) => ({
      ...prev,
      brush: { ...prev.brush, softness: Math.max(0, Math.min(1, softness)) },
    }));
  }, []);

  const setBrushStrength = useCallback((strength: number) => {
    setState((prev) => ({
      ...prev,
      brush: { ...prev.brush, strength: Math.max(0, Math.min(1, strength)) },
    }));
  }, []);

  const setIsPainting = useCallback((isPainting: boolean) => {
    setState((prev) => ({ ...prev, isPainting }));
  }, []);

  const setBrushSettings = useCallback((settings: Partial<BrushSettings>) => {
    setState((prev) => ({
      ...prev,
      brush: { ...prev.brush, ...settings },
    }));
  }, []);

  return {
    state,
    actions: {
      setMode,
      setSelectedTexture,
      setBrushRadius,
      setBrushSoftness,
      setBrushStrength,
      setIsPainting,
      setBrushSettings,
    },
  };
}

/**
 * Get display name for a paint mode
 */
export function getPaintModeName(mode: PaintMode): string {
  switch (mode) {
    case PAINT_MODE.OFF:
      return "Off";
    case PAINT_MODE.BASE_TEXTURE:
      return "Base Texture";
    case PAINT_MODE.OVERLAY_TEXTURE:
      return "Overlay Texture";
    case PAINT_MODE.BLEND:
      return "Blend";
    case PAINT_MODE.HEIGHTMAP_RAISE:
      return "Raise Terrain";
    case PAINT_MODE.HEIGHTMAP_LOWER:
      return "Lower Terrain";
    default:
      return "Unknown";
  }
}

/**
 * Get texture info by ID
 */
export function getTextureById(id: TerrainTextureId) {
  return TERRAIN_TEXTURES.find((t) => t.id === id) ?? TERRAIN_TEXTURES[0];
}
