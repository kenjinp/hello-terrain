"use client";

import { LoadingBar } from "@/components/LoadingBar/LoadingBar";
import { Eye, EyeOff, Maximize, Minimize } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ExamplesCanvasContextValue {
  /** Whether UI overlays should be visible */
  showUI: boolean;
  /** Whether the canvas is in fullscreen mode */
  isFullscreen: boolean;
}

const ExamplesCanvasContext = createContext<ExamplesCanvasContextValue>({
  showUI: true,
  isFullscreen: false,
});

/**
 * Hook to access the ExamplesCanvas context.
 * Use this in example scenes to conditionally render UI overlays.
 */
export function useExamplesCanvas() {
  return useContext(ExamplesCanvasContext);
}

interface ExamplesCanvasProps {
  /** The Canvas and scene content */
  children: ReactNode;
  /** Additional class names for the container */
  className?: string;
}

/**
 * A styled wrapper component for all example scenes.
 * Provides:
 * - Loading progress bar
 * - Fullscreen toggle button
 * - UI visibility toggle button (for hiding example overlays)
 */
export function ExamplesCanvas({ children, className = "" }: ExamplesCanvasProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFakeFullscreen, setIsFakeFullscreen] = useState(false);
  const [showUI, setShowUI] = useState(true);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Combined fullscreen state (native or fake)
  const isInFullscreen = isFullscreen || isFakeFullscreen;

  // Check if fullscreen is supported on mount
  useEffect(() => {
    // Check for fullscreen support (not available on iOS Safari)
    const supported =
      document.fullscreenEnabled ||
      // @ts-expect-error - vendor prefixed
      document.webkitFullscreenEnabled ||
      // @ts-expect-error - vendor prefixed
      document.mozFullScreenEnabled ||
      // @ts-expect-error - vendor prefixed
      document.msFullscreenEnabled;
    setFullscreenSupported(!!supported);
  }, []);

  // Lock body scroll when in fake fullscreen
  useEffect(() => {
    if (isFakeFullscreen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isFakeFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    const elem = containerRef.current;
    if (!elem) return;

    // If native fullscreen is not supported, use fake fullscreen
    if (!fullscreenSupported) {
      setIsFakeFullscreen((prev) => !prev);
      return;
    }

    // Get the current fullscreen element (with vendor prefixes)
    const fullscreenElement =
      document.fullscreenElement ||
      // @ts-expect-error - vendor prefixed
      document.webkitFullscreenElement ||
      // @ts-expect-error - vendor prefixed
      document.mozFullScreenElement ||
      // @ts-expect-error - vendor prefixed
      document.msFullscreenElement;

    if (!fullscreenElement) {
      // Request fullscreen with vendor prefixes
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
        // @ts-expect-error - vendor prefixed
      } else if (elem.webkitRequestFullscreen) {
        // @ts-expect-error - vendor prefixed
        await elem.webkitRequestFullscreen();
        // @ts-expect-error - vendor prefixed
      } else if (elem.mozRequestFullScreen) {
        // @ts-expect-error - vendor prefixed
        await elem.mozRequestFullScreen();
        // @ts-expect-error - vendor prefixed
      } else if (elem.msRequestFullscreen) {
        // @ts-expect-error - vendor prefixed
        await elem.msRequestFullscreen();
      }
    } else {
      // Exit fullscreen with vendor prefixes
      if (document.exitFullscreen) {
        await document.exitFullscreen();
        // @ts-expect-error - vendor prefixed
      } else if (document.webkitExitFullscreen) {
        // @ts-expect-error - vendor prefixed
        await document.webkitExitFullscreen();
        // @ts-expect-error - vendor prefixed
      } else if (document.mozCancelFullScreen) {
        // @ts-expect-error - vendor prefixed
        await document.mozCancelFullScreen();
        // @ts-expect-error - vendor prefixed
      } else if (document.msExitFullscreen) {
        // @ts-expect-error - vendor prefixed
        await document.msExitFullscreen();
      }
    }
  }, [fullscreenSupported]);

  const toggleUI = useCallback(() => {
    setShowUI((prev) => !prev);
  }, []);

  // Listen for fullscreen changes (with vendor prefixes)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenElement =
        document.fullscreenElement ||
        // @ts-expect-error - vendor prefixed
        document.webkitFullscreenElement ||
        // @ts-expect-error - vendor prefixed
        document.mozFullScreenElement ||
        // @ts-expect-error - vendor prefixed
        document.msFullscreenElement;
      setIsFullscreen(!!fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when the container is focused or in fullscreen
      if (!containerRef.current?.contains(document.activeElement) && !isInFullscreen) {
        return;
      }

      // 'F' for fullscreen
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      }

      // 'U' for UI toggle
      if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        toggleUI();
      }

      // Escape to exit fake fullscreen
      if (e.key === "Escape" && isFakeFullscreen) {
        setIsFakeFullscreen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isInFullscreen, isFakeFullscreen, toggleFullscreen, toggleUI]);

  const contextValue: ExamplesCanvasContextValue = {
    showUI,
    isFullscreen: isInFullscreen,
  };

  const fakeFullscreenStyles: React.CSSProperties = isFakeFullscreen
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100dvw",
        height: "100dvh",
        zIndex: 9999,
        borderRadius: 0,
      }
    : {};

  return (
    <ExamplesCanvasContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={`relative w-full h-full overflow-hidden backdrop-blur-sm select-none ${
          isFakeFullscreen ? "" : "rounded"
        } ${className}`}
        style={{ WebkitTouchCallout: "none", ...fakeFullscreenStyles }}
        tabIndex={0}
      >
        {/* Loading progress bar */}
        <LoadingBar />

        {/* Scene content */}
        {children}

        {/* Control buttons */}
        <div className="absolute top-2 left-2 md:top-4 md:left-4 z-20 flex gap-1.5 md:gap-2">
          {/* UI Toggle button */}
          <button
            type="button"
            onClick={toggleUI}
            className={`p-1.5 md:p-2 rounded-md md:rounded-lg transition-all backdrop-blur-sm border ${
              showUI
                ? "bg-black/50 hover:bg-black/70 text-white border-white/10"
                : "bg-white/90 hover:bg-white text-black border-black/10"
            }`}
            aria-label={showUI ? "Hide UI overlays" : "Show UI overlays"}
            title={showUI ? "Hide UI (U)" : "Show UI (U)"}
          >
            {showUI ? (
              <Eye className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
            ) : (
              <EyeOff className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
            )}
          </button>

          {/* Fullscreen button - always shown, uses fake fullscreen on unsupported devices */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 md:p-2 rounded-md md:rounded-lg bg-black/50 hover:bg-black/70 text-white transition-colors backdrop-blur-sm border border-white/10"
            aria-label={isInFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isInFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
          >
            {isInFullscreen ? (
              <Minimize className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
            ) : (
              <Maximize className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </ExamplesCanvasContext.Provider>
  );
}
