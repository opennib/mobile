import { useMemo, useState } from "react"
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native"
import Svg, { Circle, Path } from "react-native-svg"
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@opennib/core"

import { useSettings } from "../hooks/use-settings"
import { SettingsShell } from "../components/SettingsShell"
import { tokens } from "../theme/tokens"

interface Props {
  readonly onClose: () => void
}

/**
 * Language picker — paper shell + magnifier-prefixed search field + ink-toned
 * radio list. Visually aligned with the History / Dictionary surfaces so the
 * picker doesn't feel like a different app dropped in mid-flow. There is no
 * dedicated frame for this in the handoff PDF; we follow the same shell
 * primitives the design uses everywhere else.
 */
export function LanguagePickerScreen({ onClose }: Props) {
  const settings = useSettings()
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => filterLanguages(SUPPORTED_LANGUAGES, query), [query])

  if (!settings.ready) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  const current = settings.snapshot.language
  const setLanguage = settings.setLanguage

  function renderItem({ item, index }: ListRenderItemInfo<SupportedLanguage>) {
    const selected = item.tag === current
    const isLast = index === filtered.length - 1
    return (
      <Pressable
        style={({ pressed }) => [
          styles.row,
          !isLast && styles.rowDivider,
          pressed && !selected && styles.rowPressed,
        ]}
        onPress={() => {
          void setLanguage(item.tag).then(onClose)
        }}
      >
        <View style={[styles.radio, selected && styles.radioActive]}>
          {selected && <View style={styles.radioDot} />}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{item.displayName}</Text>
          {item.nativeName !== item.displayName && (
            <Text style={styles.rowSubtitle}>{item.nativeName}</Text>
          )}
        </View>
      </Pressable>
    )
  }

  return (
    <SettingsShell
      tab="model"
      title="Language"
      onClose={onClose}
      hideTabs
      contentStyle={styles.scrollContent}
    >
      <View style={styles.searchField}>
        <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          <Circle cx={6} cy={6} r={4.5} stroke={tokens.ink3} strokeWidth={1.4} />
          <Path d="M9.5 9.5l3 3" stroke={tokens.ink3} strokeWidth={1.4} strokeLinecap="round" />
        </Svg>
        <TextInput
          style={styles.search}
          placeholder="Search languages"
          placeholderTextColor={tokens.ink3}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      <View style={styles.listCard}>
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.tag}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </SettingsShell>
  )
}

function filterLanguages(
  list: readonly SupportedLanguage[],
  query: string,
): readonly SupportedLanguage[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed.length === 0) return list
  return list.filter((l) => {
    return (
      l.displayName.toLowerCase().includes(trimmed) ||
      l.nativeName.toLowerCase().includes(trimmed) ||
      l.tag.toLowerCase().includes(trimmed)
    )
  })
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 48 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.paper,
  },
  loadingText: { color: tokens.ink3, fontSize: 14 },
  searchField: {
    marginHorizontal: 16,
    marginBottom: 14,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: tokens.paper2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  search: {
    flex: 1,
    color: tokens.ink,
    fontSize: 14,
    padding: 0,
    margin: 0,
  },
  listCard: {
    marginHorizontal: 16,
    backgroundColor: tokens.card,
    borderRadius: 14,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.hair2,
  },
  rowPressed: { backgroundColor: tokens.paper2 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.2,
    borderColor: tokens.ink4,
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: { backgroundColor: tokens.ink, borderWidth: 0 },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.paper },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15.5, fontWeight: "500", color: tokens.ink, letterSpacing: -0.2 },
  rowSubtitle: { fontSize: 13, color: tokens.ink3, marginTop: 2 },
})
