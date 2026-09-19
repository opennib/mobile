import { Pressable, StyleSheet, Text, View } from "react-native"
import Svg, { Path } from "react-native-svg"

import { tokens } from "../theme/tokens"

/**
 * Shared notice / banner — error · warning · success. Mirrors `NoticeCard`
 * from the design primitives: colored round icon + title + body + optional
 * action link with arrow.
 */
export type NoticeTone = "error" | "warn" | "success"

export interface NoticeCardProps {
  readonly tone?: NoticeTone
  readonly title: string
  readonly body?: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}

const CONFIG: Record<NoticeTone, { accent: string; bg: string; glyph: React.ReactNode }> = {
  error: {
    accent: tokens.rec,
    bg: tokens.recSoft,
    glyph: <Path d="M4 4l6 6M10 4l-6 6" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" />,
  },
  warn: {
    accent: tokens.warn,
    bg: tokens.warnSoft,
    glyph: <Path d="M7 3.2v4.4M7 10.2v.05" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" />,
  },
  success: {
    accent: tokens.success,
    bg: tokens.successSoft,
    glyph: (
      <Path
        d="M3.5 7.2l2.4 2.4L10.5 4.6"
        stroke="#fff"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
}

export function NoticeCard({
  tone = "error",
  title,
  body,
  actionLabel,
  onAction,
}: NoticeCardProps) {
  const cfg = CONFIG[tone]
  return (
    <View style={[styles.root, { backgroundColor: cfg.bg }]}>
      <View style={[styles.iconCircle, { backgroundColor: cfg.accent }]}>
        <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          {cfg.glyph}
        </Svg>
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: cfg.accent }]}>{title}</Text>
        {body !== undefined && <Text style={styles.body}>{body}</Text>}
        {actionLabel !== undefined && (
          <Pressable
            onPress={onAction}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <Text style={[styles.actionLabel, { color: cfg.accent }]}>{actionLabel}</Text>
            <Svg width={10} height={10} viewBox="0 0 10 10" fill="none">
              <Path
                d="M2 5h6M5 2l3 3-3 3"
                stroke={cfg.accent}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "flex-start",
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 12.5,
    color: tokens.ink2,
    marginTop: 2,
    lineHeight: 18,
  },
  action: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  actionPressed: {
    opacity: 0.6,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
})
