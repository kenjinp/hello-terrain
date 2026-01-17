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
    // Panel backgrounds - matches fd-card/fd-secondary
    elevation1: "#191919", // fd-card - main panel background
    elevation2: "#121212", // fd-background - input backgrounds
    elevation3: "#2a2a2a", // slightly lighter for hover states
    // Accent colors - neutral grays to match fumadocs neutral theme
    accent1: "#404040", // inactive/default
    accent2: "#525252", // hover
    accent3: "#6b6b6b", // active
    // Text colors - matches fd-muted-foreground to fd-foreground
    highlight1: "#666666", // very muted text
    highlight2: "#8c8c8c", // secondary text (fd-muted-foreground)
    highlight3: "#ebebeb", // primary text (fd-foreground)
    // Warning/special color
    vivid1: "#f5a623",
  },
  radii: {
    xs: "4px",
    sm: "6px", // matches fumadocs rounded-md
    lg: "12px", // matches fumadocs rounded-xl
  },
  space: {
    sm: "6px",
    md: "10px",
    rowGap: "7px",
    colGap: "7px",
  },
  fontSizes: {
    root: "13px", // matches fumadocs code block text size
  },
  sizes: {
    rootWidth: "280px",
    controlWidth: "160px",
    scrubberWidth: "8px",
    scrubberHeight: "16px",
    rowHeight: "24px",
    folderHeight: "20px",
    checkboxSize: "16px",
    joystickWidth: "100px",
    joystickHeight: "100px",
    colorPickerWidth: "160px",
    colorPickerHeight: "100px",
    monitorHeight: "60px",
    titleBarHeight: "39px",
  },
  borderWidths: {
    root: "1px", // fumadocs code block has border
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
