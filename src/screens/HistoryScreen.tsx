import { useState } from "react"
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import * as Clipboard from "expo-clipboard"
import type { TranscriptEntry } from "@opennib/core"
import Svg, { Circle, Path } from "react-native-svg"

import { useHistory } from "../hooks/use-history"
import { SettingsShell } from "../components/SettingsShell"
import { TranscriptCard } from "../components/TranscriptCard"
import { tokens } from "../theme/tokens"

interface Props {
  readonly onClose: () => void
}

/**
 * M-S-4 · History — full-page paper shell (tabs hidden), search field + chip,
 * scrollable TranscriptCard list. Tap any card to copy. Long-press intent
 * (e.g. swipe-to-delete) is left for a future iteration; for now Settings →
 * Data → Clear history (matching desktop) covers bulk removal.
 */
export function HistoryScreen({ onClose }: Props) {
  const history = useHistory()
  const [query, setQuery] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)

  if (!history.ready) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  const entries = history.entries
  const clearAll = history.clear
  const filtered =
    query.trim() === ""
      ? entries
      : entries.filter((e) => e.text.toLowerCase().includes(query.toLowerCase()))

  function copy(entry: TranscriptEntry): void {
    void Clipboard.setStringAsync(entry.text).then(() => {
      setCopiedId(entry.id)
      setTimeout(() => {
        setCopiedId((curr) => (curr === entry.id ? null : curr))
      }, 1200)
    })
  }

  function confirmClear(): void {
    if (entries.length === 0) return
    Alert.alert(
      "Clear all transcripts?",
      "This will delete every transcript on this device. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearAll()
          },
        },
      ],
    )
  }

  return (
    <SettingsShell
      tab="history"
      title="History"
      onClose={onClose}
      hideTabs
      contentStyle={styles.scrollContent}
    >
      <View style={styles.toolbar}>
        <View style={styles.searchField}>
          <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
            <Circle cx={6} cy={6} r={4.5} stroke={tokens.ink3} strokeWidth={1.4} />
            <Path d="M9.5 9.5l3 3" stroke={tokens.ink3} strokeWidth={1.4} strokeLinecap="round" />
          </Svg>
          <TextInput
            placeholder="Search transcripts"
            placeholderTextColor={tokens.ink3}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <Pressable
          onPress={confirmClear}
          hitSlop={6}
          disabled={entries.length === 0}
          style={({ pressed }) => [
            styles.clearChip,
            entries.length === 0 && styles.clearChipDisabled,
            pressed && styles.clearChipPressed,
          ]}
        >
          <Text
            style={[styles.clearChipText, entries.length === 0 && styles.clearChipTextDisabled]}
          >
            Clear
          </Text>
        </Pressable>
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No transcripts yet</Text>
          <Text style={styles.emptyBody}>
            Hold the mic on the home screen and your transcripts will show up here.
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptyBody}>Try a shorter search term.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {filtered.map((entry) => (
            <TranscriptCard
              key={entry.id}
              time={describeWhen(entry.createdAt)}
              length={formatDuration(entry.durationMs)}
              lang={entry.language === "auto" ? "AUTO" : entry.language.toUpperCase()}
              text={copiedId === entry.id ? "Copied to clipboard" : entry.text}
              muted={copiedId === entry.id}
              onPress={() => copy(entry)}
            />
          ))}
        </View>
      )}
    </SettingsShell>
  )
}

function describeWhen(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatDuration(ms: number): string {
  if (ms <= 0) return ""
  const total = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 48,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.paper,
  },
  loadingText: { color: tokens.ink3, fontSize: 14 },
  toolbar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
    alignItems: "center",
  },
  searchField: {
    flex: 1,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: tokens.paper2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: tokens.ink,
    fontSize: 14,
    padding: 0,
    margin: 0,
  },
  clearChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: tokens.paper2,
    alignItems: "center",
    justifyContent: "center",
  },
  clearChipDisabled: { opacity: 0.4 },
  clearChipPressed: { opacity: 0.6 },
  clearChipText: {
    // Design M-A-6 uses an ink-colored chip (decorative "All" filter) rather
    // than a destructive accent — we soften to ink so the chip reads as a
    // secondary control instead of a warning, even though it still drives
    // the clear-all destructive action.
    color: tokens.ink2,
    fontSize: 14,
    fontWeight: "500",
  },
  clearChipTextDisabled: { color: tokens.ink3 },
  list: {
    paddingHorizontal: 16,
    gap: 10,
  },
  empty: {
    paddingHorizontal: 32,
    paddingTop: 40,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: tokens.ink2,
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 14,
    color: tokens.ink3,
    textAlign: "center",
    lineHeight: 20,
  },
})
