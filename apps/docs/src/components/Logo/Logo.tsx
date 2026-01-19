interface LogoProps {
  size?: "sm" | "md" | "lg";
}

export function Logo({ size = "md" }: LogoProps) {
  const sizeMap = {
    sm: 24,
    md: 48,
    lg: 96,
  };

  const emojiFontSizeMap = {
    sm: 10,
    md: 12,
    lg: 12,
  };

  const emojiYPositionMap = {
    sm: 10,
    md: 8,
    lg: 8,
  };

  const emojiFontSize = emojiFontSizeMap[size];

  return (
    <svg
      width={sizeMap[size]}
      height={sizeMap[size]}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Terrain Logo"
      role="img"
      className="terrain-logo"
    >
      {/* Speech bubble */}
      <path
        d="M4 4c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H8.83L5.59 20.17A1 1 0 0 1 4 19.41V4z"
        fill="#6dd1ed"
      />
      {/* Mountain emoji in the center */}
      <text
        x="12"
        y={emojiYPositionMap[size]}
        textAnchor="middle"
        alignmentBaseline="middle"
        fontSize={emojiFontSize}
        fontFamily="Apple Color Emoji,Segoe UI Emoji,NotoColorEmoji,Android Emoji,EmojiSymbols"
      >
        ⛰️
      </text>
    </svg>
  );
}
