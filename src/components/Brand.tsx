import { Text, View } from "react-native"
import Svg, { Circle, Line, Path } from "react-native-svg"

import { tokens, wordmarkFontFamily } from "../theme/tokens"

/**
 * opennib brand glyph — a pen nib shape (rounded shoulders, pointed tip,
 * breather hole + tine slit). Paths mirror desktop's `NibGlyph` exactly so
 * the brand reads the same across surfaces.
 */
export interface NibGlyphProps {
  readonly size?: number
  readonly color?: string
  readonly strokeWidth?: number
}

export function NibGlyph({ size = 24, color = tokens.ink, strokeWidth }: NibGlyphProps) {
  const sw = strokeWidth ?? Math.max(1.4, Math.min(4, size / 20))
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 5 6 Q 5 3, 8 3 L 16 3 Q 19 3, 19 6 L 19 12 L 12 21.5 L 5 12 Z"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={12} cy={7.5} r={Math.max(1.1, sw * 0.95)} fill={color} />
      <Line
        x1={12}
        y1={9.7}
        x2={12}
        y2={17}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </Svg>
  )
}

/**
 * "opennib" wordmark. Newsreader italic on desktop; mobile falls back to
 * Iowan Old Style (iOS bundled serif) via `fontFamily` + an italic style.
 */
export interface WordmarkProps {
  readonly size?: number
  readonly color?: string
}

export function Wordmark({ size = 28, color = tokens.ink }: WordmarkProps) {
  return (
    <Text
      style={{
        fontFamily: wordmarkFontFamily,
        fontStyle: "italic",
        fontWeight: "400",
        fontSize: size,
        lineHeight: size,
        letterSpacing: -0.5,
        color,
      }}
    >
      opennib
    </Text>
  )
}

/**
 * Tile lockup — black rounded square with the nib glyph centered, sized for
 * the sidebar/header lockup. Matches the design's `<div>` containing
 * `<NibGlyph color="var(--paper)">` on `background: var(--ink)`.
 */
export interface NibTileProps {
  readonly size?: number
  readonly radius?: number
  readonly glyphSize?: number
  readonly bg?: string
  readonly fg?: string
}

export function NibTile({
  size = 32,
  radius,
  glyphSize,
  bg = tokens.ink,
  fg = tokens.paper,
}: NibTileProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.28),
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <NibGlyph size={glyphSize ?? Math.round(size * 0.56)} color={fg} />
    </View>
  )
}

/**
 * Inline horizontal lockup: bare nib glyph + wordmark side by side. Matches
 * the design's `Lockup` primitive in `handoff_opennib/sources/frames.jsx` —
 * NO dark background tile here. Tile-style brand marks (onboarding hero,
 * about card) use `<NibTile>` separately. Single `size` controls the glyph
 * and the wordmark autosizes to `size + 6` like the design.
 */
export interface LockupProps {
  readonly size?: number
  readonly color?: string
}

export function Lockup({ size = 22, color = tokens.ink }: LockupProps) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <NibGlyph size={size} color={color} />
      <Wordmark size={size + 6} color={color} />
    </View>
  )
}
