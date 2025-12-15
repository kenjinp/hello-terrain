// Painting UI Components
export { BrushSettings, type BrushSettingsProps } from "./BrushSettings";
export {
  PaintingToolbar,
  type PaintingToolbarProps,
} from "./PaintingToolbar";
export {
  PaintModeSelector,
  type PaintModeSelectorProps,
} from "./PaintModeSelector";
export { TexturePalette, type TexturePaletteProps } from "./TexturePalette";

// State Management
export {
  DEFAULT_PAINTING_STATE,
  getPaintModeName,
  getTextureById,
  TERRAIN_TEXTURES,
  usePaintingState,
  type BrushSettings as BrushSettingsType,
  type PaintingActions,
  type PaintingState,
  type TerrainTextureId,
} from "./usePaintingState";

// Shader Nodes
export {
  calculateBrushFalloff,
  createBrushPreviewUniforms,
  createPaintableTerrainColorNode,
  PAINT_MODE,
  type BrushPreviewUniforms,
  type PaintableTerrainColorNodeParams,
  type PaintMode,
} from "./createPaintableTerrainColorNode";
