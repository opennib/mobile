import { useState } from "react"
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import type { DictionaryEntry } from "@opennib/core"
import Svg, { Path } from "react-native-svg"

import { useDictionary } from "../hooks/use-dictionary"
import { SettingsShell } from "../components/SettingsShell"
import { InkButton, Section } from "../components/ui"
import { monoFontFamily, tokens } from "../theme/tokens"

interface Props {
  readonly onClose: () => void
}

/**
 * M-S-3 · Dictionary — corrections list with `from → To` rows. Inline add
 * form at the bottom: mono-styled term input + plain replacement input +
 * Add button. Long-press a row to remove.
 */
export function DictionaryScreen({ onClose }: Props) {
  const dictionary = useDictionary()
  // Core semantics: `term` is the spelling to enforce ("opennib"); `replacement`
  // is what the user actually says ("open nib"). The form collects them as
  // spoken-first to match the design's `from → To` reading order.
  const [spoken, setSpoken] = useState("")
  const [insertText, setInsertText] = useState("")
  // The add form stays collapsed behind the "+ Add correction" pill (M-S-3);
  // desktop's dictionary page uses the same reveal pattern.
  const [adding, setAdding] = useState(false)

  if (!dictionary.ready) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  // Destructure once so the type narrowing on `dictionary.ready === true`
  // propagates into the callbacks below — closing over `dictionary` directly
  // gives TS the union type back.
  const entries = dictionary.entries
  const addEntry = dictionary.add
  const removeEntry = dictionary.remove
  const trimmedSpoken = spoken.trim()
  const trimmedInsert = insertText.trim()
  const canAdd = trimmedInsert.length > 0

  function onSubmit(): void {
    if (!canAdd) return
    const now = Date.now()
    const entry: DictionaryEntry = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      term: trimmedInsert,
      ...(trimmedSpoken.length > 0 ? { replacement: trimmedSpoken } : {}),
      createdAt: now,
    }
    void addEntry(entry).then(() => {
      setSpoken("")
      setInsertText("")
      setAdding(false)
    })
  }

  function confirmRemove(entry: DictionaryEntry): void {
    Alert.alert(`Remove "${entry.term}"?`, "It won't apply to future transcripts.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void removeEntry(entry.id)
        },
      },
    ])
  }

  return (
    <SettingsShell tab="dict" title="Dictionary" onClose={onClose} hideTabs>
      <View style={styles.note}>
        <Text style={styles.noteText}>
          Replace what you said with what you meant. Useful for names, brands, and acronyms
          transcription keeps mishearing.
        </Text>
      </View>

      {entries.length > 0 && (
        <Section title={`${entries.length} corrections`}>
          {entries.map((entry, i) => (
            <Pressable
              key={entry.id}
              onPress={() => confirmRemove(entry)}
              onLongPress={() => confirmRemove(entry)}
              style={({ pressed }) => [
                styles.row,
                i < entries.length - 1 && styles.rowSeparator,
                pressed && styles.rowPressed,
              ]}
            >
              <Text style={styles.rowFrom} numberOfLines={1}>
                {entry.replacement ?? entry.term}
              </Text>
              <Svg width={14} height={10} viewBox="0 0 14 10" fill="none">
                <Path
                  d="M1 5h11M9 1l3 4-3 4"
                  stroke={tokens.ink4}
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={styles.rowTo} numberOfLines={1}>
                {entry.term}
              </Text>
              <Svg width={6} height={11} viewBox="0 0 6 11" fill="none">
                <Path
                  d="M0.5 0.5l5 5-5 5"
                  stroke={tokens.ink4}
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          ))}
        </Section>
      )}

      {entries.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No corrections yet</Text>
          <Text style={styles.emptyBody}>
            Tap + Add correction below to create one. Tap a row to remove it.
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.formWrap}
      >
        {adding ? (
          <View style={styles.formCard}>
            <Text style={styles.formLabel}>Add a correction</Text>
            <TextInput
              style={styles.fromInput}
              placeholder="phrase you say"
              placeholderTextColor={tokens.ink3}
              value={spoken}
              onChangeText={setSpoken}
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
            />
            <TextInput
              style={styles.toInput}
              placeholder="what to insert"
              placeholderTextColor={tokens.ink3}
              value={insertText}
              onChangeText={setInsertText}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={onSubmit}
            />
            <InkButton variant="primary" size="md" onPress={onSubmit} disabled={!canAdd}>
              Add correction
            </InkButton>
            <InkButton
              variant="ghost"
              size="md"
              onPress={() => {
                setSpoken("")
                setInsertText("")
                setAdding(false)
              }}
            >
              Cancel
            </InkButton>
          </View>
        ) : (
          <View style={styles.addButtonWrap}>
            <InkButton variant="secondary" size="md" onPress={() => setAdding(true)}>
              + Add correction
            </InkButton>
          </View>
        )}
      </KeyboardAvoidingView>
    </SettingsShell>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.paper,
  },
  loadingText: { color: tokens.ink3, fontSize: 14 },
  note: {
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  noteText: {
    fontSize: 13.5,
    color: tokens.ink2,
    lineHeight: 19,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.hair2,
  },
  rowPressed: { backgroundColor: tokens.paper2, opacity: 0.9 },
  rowFrom: {
    flex: 0,
    width: 110,
    fontFamily: monoFontFamily,
    fontSize: 12.5,
    color: tokens.ink3,
    letterSpacing: 0.2,
  },
  rowTo: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: "500",
    color: tokens.ink,
    letterSpacing: -0.2,
  },
  empty: {
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 32,
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
  formWrap: { marginTop: 18 },
  addButtonWrap: { paddingHorizontal: 16 },
  formCard: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: tokens.card,
    gap: 8,
  },
  formLabel: {
    fontFamily: monoFontFamily,
    fontSize: 10.5,
    color: tokens.ink3,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  fromInput: {
    fontFamily: monoFontFamily,
    fontSize: 13,
    color: tokens.ink,
    backgroundColor: tokens.paper,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.hair,
  },
  toInput: {
    fontSize: 15,
    color: tokens.ink,
    backgroundColor: tokens.paper,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.hair,
  },
})
