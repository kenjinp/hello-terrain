"use client";

import { useProgress } from "@react-three/drei";

export const LoadingBar = () => {
  const { active, progress } = useProgress();

  if (!active) return null;

  return (
    <div className="absolute top-0 left-0 right-0 z-10">
      {/* Progress bar container */}
      <div className="h-1 bg-black/30 backdrop-blur-sm">
        <div
          className="h-full bg-[#6dd1ed] transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      {/* Progress text */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md rounded-full px-4 py-1.5 border border-white/10">
        <span className="text-sm text-white/90 font-medium">
          Loading assets... {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
};
