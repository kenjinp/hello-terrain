"use client";

import { useEffect, useState } from "react";
import { TERRAIN_TEXTURES, type TerrainTextureId } from "./usePaintingState";

export interface TexturePaletteProps {
  /** Currently selected texture ID */
  selectedId: TerrainTextureId;
  /** Callback when a texture is selected */
  onSelect: (id: TerrainTextureId) => void;
}

/**
 * TexturePalette component
 *
 * Displays a grid of available terrain textures with thumbnails.
 * Shows color preview for each texture and highlights the selected one.
 */
export function TexturePalette({ selectedId, onSelect }: TexturePaletteProps) {
  // Track loaded thumbnail URLs
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  // Load thumbnail images
  useEffect(() => {
    const loadedThumbnails: Record<number, string> = {};

    for (const texture of TERRAIN_TEXTURES) {
      // Handle different naming conventions
      const colorPath =
        texture.name === "Sand"
          ? `${texture.path}_albedo.png`
          : `${texture.path}-color.png`;
      loadedThumbnails[texture.id] = colorPath;
    }

    setThumbnails(loadedThumbnails);
  }, []);

  return (
    <div className="space-y-2">
      <h3 className="text-white/90 font-semibold text-sm border-b border-white/10 pb-1">
        Textures
      </h3>

      <div className="grid grid-cols-3 gap-2">
        {TERRAIN_TEXTURES.map((texture) => {
          const isSelected = texture.id === selectedId;
          const thumbnailUrl = thumbnails[texture.id];

          return (
            <button
              key={texture.id}
              type="button"
              onClick={() => onSelect(texture.id)}
              className={`
                relative flex flex-col items-center gap-1 p-1.5 rounded-lg
                transition-all duration-150 cursor-pointer
                ${
                  isSelected
                    ? "bg-blue-500/40 ring-2 ring-blue-400 ring-offset-1 ring-offset-transparent"
                    : "bg-white/10 hover:bg-white/20"
                }
              `}
              title={texture.name}
            >
              {/* Texture thumbnail */}
              <div
                className="w-12 h-12 rounded-md bg-cover bg-center border border-white/20"
                style={{
                  backgroundImage: thumbnailUrl
                    ? `url(${thumbnailUrl})`
                    : undefined,
                  backgroundColor: thumbnailUrl ? undefined : "#444",
                }}
              />

              {/* Texture name */}
              <span className="text-white/80 text-xs truncate w-full text-center">
                {texture.name}
              </span>

              {/* Selection indicator */}
              {isSelected && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-400 rounded-full flex items-center justify-center">
                  <svg
                    className="w-2.5 h-2.5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
