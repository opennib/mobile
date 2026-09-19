import { useEffect, useRef } from "react"
import { Animated, Easing, View } from "react-native"

import { tokens } from "../theme/tokens"

/**
 * Always-animating waveform bars driven by per-bar Animated values on a
 * staggered sine cycle. Matches `LiveWave` in the design: 22–32 bars with
 * varying peaks and durations so the result reads as recording activity
 * without consuming a real audio-level stream.
 */
export interface LiveWaveProps {
  readonly width?: number
  readonly height?: number
  readonly bars?: number
  readonly color?: string
  /**
   * Audio amplitude scalar (0..1) driving overall bar height. When provided,
   * bars at 0 collapse to a near-flat baseline and bars at 1 reach full
   * sine-loop amplitude — matches the desktop HUD's mic-reactive behavior.
   * Omit for a purely decorative ever-animating wave.
   */
  readonly level?: number
}

export function LiveWave({
  width = 260,
  height = 56,
  bars = 32,
  color = tokens.rec,
  level,
}: LiveWaveProps) {
  // One Animated.Value per bar, kept stable across renders. The per-bar
  // animation is the *shape* (waveform variance); `intensityRef` scales the
  // shape against the latest audio level so silence ⇒ near-flat, loud speech
  // ⇒ full sine amplitude.
  const animatedValues = useRef(Array.from({ length: bars }, () => new Animated.Value(0.3))).current
  const intensity = useRef(new Animated.Value(level ?? 1)).current

  useEffect(() => {
    const animations = animatedValues.map((value, i) => {
      const duration = 500 + ((i * 7) % 5) * 130
      const delay = ((i * 3) % 7) * 80
      const peak = 0.4 + Math.abs(Math.sin(i * 0.9) + Math.cos(i * 0.5)) * 0.4
      return Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: peak,
            duration: duration / 2,
            easing: Easing.inOut(Easing.sin),
            delay,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.2,
            duration: duration / 2,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      )
    })
    animations.forEach((a) => a.start())
    return () => {
      animations.forEach((a) => a.stop())
    }
  }, [animatedValues])

  // Smooth-step the intensity toward the latest level so the bars don't pop.
  useEffect(() => {
    if (level === undefined) return
    const animation = Animated.timing(intensity, {
      toValue: Math.max(0.05, Math.min(1, level)),
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [intensity, level])

  const barW = Math.max(2, (width - (bars - 1) * 3) / bars)

  return (
    <View
      style={{
        width,
        height,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
      }}
    >
      {animatedValues.map((value, i) => (
        <Animated.View
          key={i}
          style={{
            width: barW,
            height: "100%",
            borderRadius: barW / 2,
            backgroundColor: color,
            opacity: 0.9,
            transform: [{ scaleY: Animated.multiply(value, intensity) }],
          }}
        />
      ))}
    </View>
  )
}

/**
 * Frozen, dimmed waveform shown while transcribing — matches the design's
 * "dim the captured audio + show progress" pattern.
 */
export function WaveformFrozen({
  width = 260,
  height = 56,
  bars = 32,
  color = tokens.ink3,
}: LiveWaveProps) {
  const barW = Math.max(2, (width - (bars - 1) * 3) / bars)
  return (
    <View
      style={{
        width,
        height,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
      }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const h = 0.3 + Math.abs(Math.sin(i * 0.6) * 0.55 + Math.cos(i * 1.1) * 0.18)
        return (
          <View
            key={i}
            style={{
              width: barW,
              height: "100%",
              borderRadius: barW / 2,
              backgroundColor: color,
              opacity: 0.32,
              transform: [{ scaleY: Math.min(1, h) }],
            }}
          />
        )
      })}
    </View>
  )
}
