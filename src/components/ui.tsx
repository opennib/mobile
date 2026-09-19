import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import { monoFontFamily, tokens } from "../theme/tokens"

/**
 * Shared low-level building blocks for mobile screens — pulled out so each
 * screen file can compose without re-defining the same paper-themed primitives.
 *
 * Includes:
 *   - InkButton (primary / secondary / accent / ghost variants)
 *   - Chip (ink / rec / dark / success)
 *   - Section (mono uppercase label + card body)
 *   - SettingsRow (iOS-style row with optional value/right/left slots)
 *   - IOSToggle (iOS-style switch)
 *   - Eyebrow (small mono uppercase label)
 *   - StepLabel + Title (page header bits used by onboarding)
 *   - MonoText (utility)
 */

// ─── InkButton ───────────────────────────────────────────────────────

export type InkButtonVariant = "primary" | "secondary" | "accent" | "ghost"
export type InkButtonSize = "sm" | "md" | "lg"

export interface InkButtonProps {
  readonly children: string
  readonly variant?: InkButtonVariant
  readonly size?: InkButtonSize
  readonly trailing?: string
  readonly leading?: string
  readonly disabled?: boolean
  readonly fullWidth?: boolean
  readonly onPress?: () => void
  readonly style?: StyleProp<ViewStyle>
}

export function InkButton({
  children,
  variant = "primary",
  size = "lg",
  trailing,
  leading,
  disabled,
  fullWidth = true,
  onPress,
  style,
}: InkButtonProps) {
  const variantStyles = (() => {
    switch (variant) {
      case "primary":
        return {
          backgroundColor: tokens.ink,
          color: tokens.paper,
          borderColor: tokens.ink,
        }
      case "secondary":
        return {
          backgroundColor: "transparent",
          color: tokens.ink,
          borderColor: tokens.hair,
        }
      case "accent":
        return {
          backgroundColor: tokens.rec,
          color: "#fff",
          borderColor: tokens.rec,
        }
      case "ghost":
        return {
          backgroundColor: "transparent",
          color: tokens.ink2,
          borderColor: "transparent",
        }
    }
  })()
  const height = size === "sm" ? 36 : size === "md" ? 44 : 52
  const fontSize = size === "sm" ? 14 : 16
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          height,
          borderRadius: height / 2,
          backgroundColor: variantStyles.backgroundColor,
          borderWidth: variant === "secondary" ? 0.5 : 0,
          borderColor: variantStyles.borderColor,
          opacity: disabled === true ? 0.45 : pressed ? 0.85 : 1,
          paddingHorizontal: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          alignSelf: fullWidth ? "stretch" : "flex-start",
        },
        style,
      ]}
    >
      {leading !== undefined && (
        <Text style={{ color: variantStyles.color, fontSize, fontWeight: "600" }}>{leading}</Text>
      )}
      <Text
        style={{
          color: variantStyles.color,
          fontSize,
          fontWeight: "600",
          letterSpacing: -0.2,
        }}
      >
        {children}
      </Text>
      {trailing !== undefined && (
        <Text style={{ color: variantStyles.color, fontSize, fontWeight: "600" }}>{trailing}</Text>
      )}
    </Pressable>
  )
}

// ─── Chip ────────────────────────────────────────────────────────────

export type ChipTone = "ink" | "rec" | "dark" | "success"

export interface ChipProps {
  readonly children: string
  readonly tone?: ChipTone
  readonly style?: StyleProp<ViewStyle>
  readonly textStyle?: StyleProp<TextStyle>
}

const CHIP_TONES: Record<ChipTone, { bg: string; fg: string }> = {
  ink: { bg: tokens.paper2, fg: tokens.ink },
  rec: { bg: tokens.recSoft, fg: tokens.rec },
  dark: { bg: "rgba(255,255,255,0.12)", fg: "rgba(255,255,255,0.9)" },
  success: { bg: tokens.successSoft, fg: tokens.success },
}

export function Chip({ children, tone = "ink", style, textStyle }: ChipProps) {
  const t = CHIP_TONES[tone]
  return (
    <View
      style={[
        {
          backgroundColor: t.bg,
          paddingHorizontal: 9,
          paddingVertical: 4,
          borderRadius: 999,
          alignSelf: "flex-start",
        },
        style,
      ]}
    >
      <Text
        style={[
          {
            fontFamily: monoFontFamily,
            fontSize: 10.5,
            color: t.fg,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            fontWeight: "600",
          },
          textStyle,
        ]}
      >
        {children}
      </Text>
    </View>
  )
}

// ─── Section ─────────────────────────────────────────────────────────

export interface SectionProps {
  readonly title?: string
  readonly children: React.ReactNode
  readonly style?: StyleProp<ViewStyle>
}

export function Section({ title, children, style }: SectionProps) {
  return (
    <View style={[{ marginHorizontal: 0 }, style]}>
      {title !== undefined && (
        <Text
          style={{
            fontFamily: monoFontFamily,
            fontSize: 10.5,
            color: tokens.ink3,
            letterSpacing: 0.7,
            textTransform: "uppercase",
            paddingHorizontal: 20,
            paddingBottom: 8,
            fontWeight: "500",
          }}
        >
          {title}
        </Text>
      )}
      <View
        style={{
          backgroundColor: tokens.card,
          marginHorizontal: 16,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  )
}

// ─── SettingsRow ─────────────────────────────────────────────────────

export interface SettingsRowProps {
  readonly title: string
  readonly subtitle?: string
  readonly value?: string
  readonly left?: React.ReactNode
  readonly right?: React.ReactNode
  readonly chevron?: boolean
  readonly last?: boolean
  readonly disabled?: boolean
  readonly onPress?: () => void
}

export function SettingsRow({
  title,
  subtitle,
  value,
  left,
  right,
  chevron,
  last = false,
  disabled = false,
  onPress,
}: SettingsRowProps) {
  const baseStyle: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 48,
    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: tokens.hair2,
  }
  const body = (
    <>
      {left}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 15.5,
            color: tokens.ink,
            letterSpacing: -0.2,
          }}
        >
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text
            style={{
              fontSize: 12.5,
              color: tokens.ink3,
              marginTop: 2,
              lineHeight: 17,
            }}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {value !== undefined && <Text style={{ fontSize: 14, color: tokens.ink3 }}>{value}</Text>}
      {right}
      {chevron === true && (
        <Text
          style={{ fontSize: 18, color: tokens.ink4, marginLeft: 2 }}
          accessibilityElementsHidden
        >
          ›
        </Text>
      )}
    </>
  )
  if (onPress !== undefined && !disabled) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [baseStyle, { opacity: pressed ? 0.7 : 1 }]}
      >
        {body}
      </Pressable>
    )
  }
  return <View style={[baseStyle, { opacity: disabled ? 0.55 : 1 }]}>{body}</View>
}

// ─── IOSToggle (wrapper around the native Switch, themed) ───────────

export interface IOSToggleProps {
  readonly value: boolean
  readonly onValueChange?: (next: boolean) => void
  readonly disabled?: boolean
}

export function IOSToggle({ value, onValueChange, disabled }: IOSToggleProps) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ true: tokens.iosGreen, false: "rgba(120,120,128,0.32)" }}
      thumbColor="#fff"
      ios_backgroundColor="rgba(120,120,128,0.32)"
    />
  )
}

// ─── Eyebrow + Title + StepLabel ────────────────────────────────────

export function Eyebrow({ children }: { readonly children: string }) {
  return (
    <Text
      style={{
        fontFamily: monoFontFamily,
        fontSize: 11,
        color: tokens.ink3,
        letterSpacing: 1.0,
        textTransform: "uppercase",
        fontWeight: "500",
      }}
    >
      {children}
    </Text>
  )
}

export function StepLabel({ children }: { readonly children: string }) {
  return (
    <Text
      style={{
        fontFamily: monoFontFamily,
        fontSize: 11,
        color: tokens.ink3,
        letterSpacing: 0.6,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  )
}

export function PageTitle({
  children,
  style,
}: {
  readonly children: React.ReactNode
  readonly style?: StyleProp<TextStyle>
}) {
  return (
    <Text
      style={[
        {
          fontSize: 27,
          fontWeight: "700",
          color: tokens.ink,
          letterSpacing: -0.7,
          lineHeight: 32,
        },
        style,
      ]}
    >
      {children}
    </Text>
  )
}

export function MonoText({
  children,
  style,
}: {
  readonly children: React.ReactNode
  readonly style?: StyleProp<TextStyle>
}) {
  return (
    <Text
      style={[
        {
          fontFamily: monoFontFamily,
          letterSpacing: 0.04,
        },
        style,
      ]}
    >
      {children}
    </Text>
  )
}
