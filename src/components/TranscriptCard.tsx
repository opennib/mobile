import { Pressable, StyleSheet, Text, View } from "react-native"
import Svg, { Rect } from "react-native-svg"

import { monoFontFamily, tokens } from "../theme/tokens"

/**
 * Small clipboard glyph in the top-right of each card — matches the copy
 * icon visible in the design's M-A and M-S-4/M-A-6 frames. Decorative only:
 * the whole card is the press target when copying is wired in, so the icon
 * just signals "this is copyable" without competing for taps.
 */
function CopyGlyph() {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <Rect x={5} y={2} width={9} height={11} rx={2} stroke={tokens.ink3} strokeWidth={1.2} />
      <Rect
        x={2}
        y={5}
        width={9}
        height={11}
        rx={2}
        fill={tokens.card}
        stroke={tokens.ink3}
        strokeWidth={1.2}
      />
    </Svg>
  )
}

/**
 * Transcript row used in M-A (dictation) and M-S-4 (history). Matches the
 * design's `TranscriptCard`: card-filled surface, mono metadata header, body
 * text below. `isNew` adds a soft shadow used when a freshly-arrived
 * transcript slides in.
 */
export interface TranscriptCardProps {
  readonly time: string
  readonly text: string
  readonly length?: string
  readonly lang?: string
  readonly muted?: boolean
  readonly isNew?: boolean
  readonly onPress?: () => void
}

export function TranscriptCard({
  time,
  text,
  length,
  lang,
  muted = false,
  isNew = false,
  onPress,
}: TranscriptCardProps) {
  const Wrapper = onPress !== undefined ? Pressable : View
  return (
    <Wrapper onPress={onPress} style={[styles.root, isNew && styles.rootNew]}>
      <View style={styles.meta}>
        <Text style={styles.metaText}>
          {[time, length, lang].filter((s): s is string => Boolean(s)).join(" · ")}
        </Text>
        <CopyGlyph />
      </View>
      <Text style={[styles.body, muted && styles.bodyMuted]}>{text}</Text>
    </Wrapper>
  )
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: tokens.card,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    borderRadius: 14,
  },
  rootNew: {
    shadowColor: tokens.ink,
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  metaText: {
    fontFamily: monoFontFamily,
    fontSize: 11,
    color: tokens.ink3,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  body: {
    fontSize: 15.5,
    lineHeight: 22,
    color: tokens.ink,
    letterSpacing: -0.2,
  },
  bodyMuted: {
    color: tokens.ink3,
  },
})
