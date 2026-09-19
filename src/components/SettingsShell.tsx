import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { StatusBar } from "expo-status-bar"

import { tokens } from "../theme/tokens"
import { Eyebrow } from "./ui"

export type SettingsTab = "general" | "model" | "kbd" | "about" | "history" | "dict"

interface TabSpec {
  readonly id: SettingsTab
  readonly label: string
}

const TABS: readonly TabSpec[] = [
  { id: "general", label: "General" },
  { id: "model", label: "Model" },
  { id: "kbd", label: "Keyboard" },
  { id: "about", label: "About" },
]

export interface SettingsShellProps {
  readonly tab: SettingsTab
  readonly title: string
  readonly onClose: () => void
  readonly onChangeTab?: (next: SettingsTab) => void
  readonly hideTabs?: boolean
  readonly children: React.ReactNode
  readonly contentStyle?: StyleProp<ViewStyle>
}

/**
 * Shared shell for every settings page (M-S-1..6). Provides the back-link,
 * uppercase eyebrow, oversized title, optional tab chip row, and a scrollable
 * body. Designed to match `SettingsShell` in `handoff_opennib/sources/settings.jsx`.
 */
export function SettingsShell({
  tab,
  title,
  onClose,
  onChangeTab,
  hideTabs = false,
  children,
  contentStyle,
}: SettingsShellProps) {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.headerBar}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <View style={styles.flex} />
        <Eyebrow>{tab.toUpperCase()}</Eyebrow>
      </View>
      <View style={styles.titleBar}>
        <Text style={styles.title}>{title}</Text>
      </View>
      {!hideTabs && (
        <View style={styles.tabRow}>
          {TABS.map(({ id, label }) => {
            const active = id === tab
            return (
              <Pressable
                key={id}
                onPress={() => onChangeTab?.(id)}
                style={({ pressed }) => [
                  styles.tabChip,
                  active && styles.tabChipActive,
                  pressed && styles.tabChipPressed,
                ]}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
              </Pressable>
            )
          })}
        </View>
      )}
      {hideTabs && <View style={{ height: 14 }} />}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, contentStyle]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.paper,
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 8,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingRight: 8,
  },
  backPressed: { opacity: 0.5 },
  backChevron: {
    color: tokens.iosBlue,
    fontSize: 24,
    fontWeight: "300",
    marginTop: -3,
    lineHeight: 24,
  },
  backLabel: {
    color: tokens.iosBlue,
    fontSize: 15,
    letterSpacing: -0.2,
  },
  flex: { flex: 1 },
  titleBar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: tokens.ink,
    letterSpacing: -0.8,
  },
  tabRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
  },
  tabChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: tokens.paper2,
  },
  tabChipActive: {
    backgroundColor: tokens.ink,
  },
  tabChipPressed: {
    opacity: 0.7,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: tokens.ink2,
    letterSpacing: -0.1,
  },
  tabLabelActive: {
    color: tokens.paper,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
})
