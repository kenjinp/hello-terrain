/**
 * Leva theme matching fumadocs code block component styling.
 * Based on fumadocs-ui neutral theme (dark mode) colors.
 *
 * fumadocs CSS variables reference:
 * - fd-background: hsl(0, 0%, 7.04%) → #121212
 * - fd-card: hsl(0, 0%, 9.8%) → #191919
 * - fd-secondary: hsl(0, 0%, 12.9%) → #212121
 * - fd-muted-foreground: hsla(0, 0%, 70%, 0.8) → #B3B3B3
 * - fd-foreground: hsl(0, 0%, 92%) → #EBEBEB
 * - fd-border: hsla(0, 0%, 40%, 20%)
 */
export const levaTheme = {
  colors: {
    // Panel backgrounds - transparent to let container backdrop-blur show through
    elevation1: "transparent", // main panel background
    elevation2: "transparent", // input backgrounds
    elevation3: "rgba(255, 255, 255, 0.08)", // hover states
    // Accent colors - neutral grays to match fumadocs neutral theme
    accent1: "#404040", // inactive/default
    accent2: "#525252", // hover
    accent3: "#6b6b6b", // active
    highlight1: "rgba(255, 255, 255, 0.5)",
    highlight2: "rgba(255, 255, 255, 0.7)",
    highlight3: "rgba(255, 255, 255, 0.85)",
    // Warning/special color
    vivid1: "#f5a623",
  },
  radii: {
    xs: "2px",
    sm: "4px",
    lg: "6px",
  },
  space: {
    sm: "4px",
    md: "6px",
    rowGap: "4px",
    colGap: "4px",
  },
  fontSizes: {
    root: "9px",
  },
  sizes: {
    rootWidth: "220px",
    controlWidth: "130px",
    scrubberWidth: "6px",
    scrubberHeight: "12px",
    rowHeight: "18px",
    folderHeight: "16px",
    checkboxSize: "12px",
    joystickWidth: "80px",
    joystickHeight: "80px",
    colorPickerWidth: "130px",
    colorPickerHeight: "80px",
    monitorHeight: "40px",
    titleBarHeight: "28px",
  },
  borderWidths: {
    root: "0px",
    input: "1px",
    focus: "1px",
    hover: "1px",
    active: "1px",
    folder: "1px",
  },
  fontWeights: {
    label: "normal",
    folder: "normal",
    button: "normal",
  },
};
