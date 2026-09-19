import { useEffect, useRef } from "react"
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import Svg, { Path, Rect } from "react-native-svg"

import { tokens } from "../theme/tokens"

/**
 * Push-to-talk mic button. Three visual states:
 *   - idle:      ink-colored circle with a paper-colored mic glyph
 *   - recording: rec-colored circle with concentric pulse rings + stop square
 *   - disabled:  paper-2 circle with a muted glyph
 *
 * Designed to match the `MicButton` primitive in the handoff JSX (circle
 * shape, 88px default, recording pulse via animated halo rings).
 */
export type MicButtonState = "idle" | "recording" | "disabled"

export interface MicButtonProps {
  readonly size?: number
  readonly state?: MicButtonState
  /**
   * Red diagonal slash across the button — design M-A-5 uses it on the home
   * screen when mic permission is blocked. Off by default because the
   * onboarding denied state (M-O-2) shows a plain disabled button.
   */
  readonly slash?: boolean
  readonly onPressIn?: () => void
  readonly onPressOut?: () => void
  readonly style?: StyleProp<ViewStyle>
}

export function MicButton({
  size = 88,
  state = "idle",
  slash = false,
  onPressIn,
  onPressOut,
  style,
}: MicButtonProps) {
  const isRecording = state === "recording"
  const isDisabled = state === "disabled"

  const bg = isRecording ? tokens.rec : isDisabled ? tokens.paper2 : tokens.ink
  const fg = isRecording ? "#fff" : isDisabled ? tokens.ink4 : tokens.paper

  // Two pulse rings animating outward when recording, staggered by 0.5s so the
  // halo feels continuous instead of cyclic.
  const pulseA = useRef(new Animated.Value(0)).current
  const pulseB = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!isRecording) {
      pulseA.setValue(0)
      pulseB.setValue(0)
      return
    }
    function loop(value: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: 1600,
            easing: Easing.out(Easing.quad),
            delay,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      )
    }
    const a = loop(pulseA, 0)
    const b = loop(pulseB, 500)
    a.start()
    b.start()
    return () => {
      a.stop()
      b.stop()
    }
  }, [isRecording, pulseA, pulseB])

  const ringStyle = (value: Animated.Value, base: number): StyleProp<ViewStyle> => ({
    position: "absolute",
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: tokens.rec,
    opacity: value.interpolate({
      inputRange: [0, 1],
      outputRange: [base, 0],
    }),
    transform: [
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 2.2],
        }),
      },
    ],
  })

  return (
    <Pressable
      style={[styles.root, { width: size, height: size }, style]}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={isDisabled}
      hitSlop={12}
    >
      {isRecording && (
        <>
          <Animated.View style={ringStyle(pulseA, 0.3)} />
          <Animated.View style={ringStyle(pulseB, 0.2)} />
        </>
      )}
      <View
        style={[
          styles.body,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            // Recording carries a soft rec-tinted shadow; idle uses ink-tinted.
            shadowColor: isRecording ? tokens.rec : tokens.ink,
            shadowOpacity: isDisabled ? 0 : isRecording ? 0.33 : 0.18,
            shadowRadius: isRecording ? 30 : 20,
            shadowOffset: { width: 0, height: isRecording ? 8 : 6 },
            elevation: isDisabled ? 0 : isRecording ? 6 : 4,
          },
        ]}
      >
        {isRecording ? (
          <View
            style={{
              width: size * 0.28,
              height: size * 0.28,
              backgroundColor: "#fff",
              borderRadius: size * 0.06,
            }}
          />
        ) : (
          <Svg width={size * 0.42} height={size * 0.42} viewBox="0 0 24 24" fill="none">
            <Rect x={9} y={2.5} width={6} height={12} rx={3} fill={fg} />
            <Path
              d="M5 11 C5 14.9, 8.1 18, 12 18 C15.9 18, 19 14.9, 19 11"
              stroke={fg}
              strokeWidth={1.7}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d="M12 18 L12 21.5 M9 21.5 L15 21.5"
              stroke={fg}
              strokeWidth={1.7}
              strokeLinecap="round"
            />
          </Svg>
        )}
        {slash && (
          <View style={styles.slashOverlay} pointerEvents="none">
            <View
              style={{
                width: 4,
                height: size * 0.64,
                borderRadius: 2,
                backgroundColor: tokens.rec,
                transform: [{ rotate: "45deg" }],
              }}
            />
          </View>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    alignItems: "center",
    justifyContent: "center",
  },
  slashOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
})
