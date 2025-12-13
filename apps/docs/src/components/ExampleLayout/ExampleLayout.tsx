"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ExampleLayoutProps {
  children: React.ReactNode;
  title: string;
  description?: string;
}

export function ExampleLayout({
  children,
  title,
  description,
}: ExampleLayoutProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="example-layout-container"
      style={
        isFullscreen
          ? { width: "100vw", position: "relative" }
          : {
              // Break out of parent container to full viewport width
              width: "100vw",
              marginLeft: "calc(-50vw + 50%)",
              position: "relative",
            }
      }
    >
      {/* Canvas container */}
      <div
        className={`relative ${isFullscreen ? "h-screen" : "h-[90vh]"} w-full`}
      >
        {/* Scene content fills the container */}
        <div className="absolute inset-0">{children}</div>

        {/* Fullscreen button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-black/50 hover:bg-black/70 text-white transition-colors backdrop-blur-sm"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? (
            // Exit fullscreen icon
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            // Enter fullscreen icon
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>

        {/* Title and gradient overlay at bottom - hidden in fullscreen */}
        {!isFullscreen && (
          <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
            {/* Gradient fade from transparent to background */}
            <div
              className="h-40"
              style={{
                background:
                  "linear-gradient(to bottom, transparent 0%, var(--color-fd-background) 100%)",
              }}
            />

            {/* Title content on solid background - centered to match article content */}
            <div
              className="w-full"
              style={{ backgroundColor: "var(--color-fd-background)" }}
            >
              {/* Inner container matches fumadocs prose width */}
              <div className="max-w-[860px] mx-auto px-4 pb-6">
                <h1 className="text-4xl font-bold text-fd-foreground">
                  {title}
                </h1>
                {description && (
                  <p className="mt-2 text-lg text-fd-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

