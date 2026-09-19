/**
 * Design tokens for the mobile app. Mirrors `docs/design-references/new_design/styles.css`
 * so a side-by-side comparison with the JSX source-of-truth is straightforward.
 *
 * The palette intentionally tracks the desktop renderer's `:root` block —
 * having one Ink/Paper scale shared by every surface (desktop CSS, mobile
 * StyleSheet, iOS keyboard ext, Android IME) keeps the brand consistent.
 */

export const tokens = {
  // paper (light)
  ink: "#17181c",
  ink2: "#565a63",
  ink3: "#8b909a",
  ink4: "#c2c6cd",
  paper: "#f5f6f8",
  paper2: "#eceef2",
  card: "#ffffff",
  hair: "rgba(20, 22, 28, 0.08)",
  hair2: "rgba(20, 22, 28, 0.05)",

  // the one accent — ink-red, like a stamp
  rec: "#d64a2c",
  recSoft: "rgba(214, 74, 44, 0.1)",

  // iOS system tints (used sparingly — toggles + the big success circles)
  iosBlue: "#0a7aff",
  iosGreen: "#34c759",

  // status
  success: "#1f9d57",
  successSoft: "rgba(31, 157, 87, 0.14)",
  warn: "#a16207",
  warnSoft: "rgba(161, 98, 7, 0.12)",
  danger: "#c14545",
} as const

/**
 * Wordmark font stack. Newsreader-Italic would match the desktop exactly;
 * shipping a custom font on mobile requires `expo-font` + a native rebuild
 * which is out of scope for the visual-only pass. The serif italic fallback
 * (Iowan Old Style → Georgia) lands close enough for now.
 */
export const wordmarkFontFamily =
  // RN doesn't accept the CSS-style comma list, so we pick the most likely
  // installed serif on iOS first; Android falls through to its bundled
  // serif via the fontStyle: "italic" hint at the call site.
  "Iowan Old Style"

export const monoFontFamily = "Menlo"
