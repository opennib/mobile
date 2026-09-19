import { useState } from "react"
import { Linking, Pressable, StyleSheet, Text, View } from "react-native"
import {
  SUPPORTED_LANGUAGES,
  WHISPER_MODELS,
  isSupportedLanguage,
  isWhisperModelId,
} from "@opennib/core"

import { useSettings } from "../hooks/use-settings"
import { useKeyboardStatus } from "../hooks/use-keyboard-status"
import { usePermissions } from "../hooks/use-permissions"
import { SettingsShell, type SettingsTab } from "../components/SettingsShell"
import { Chip, IOSToggle, InkButton, Section, SettingsRow } from "../components/ui"
import { NibTile, Wordmark } from "../components/Brand"
import { monoFontFamily, tokens } from "../theme/tokens"

const KEYBOARD_SETTINGS_URL = "App-Prefs:General&path=Keyboard/KEYBOARDS"

interface Props {
  readonly onClose: () => void
  readonly onPickLanguage: () => void
  /** Not used by the new design (history pill lives on Home), kept so the
   *  Shell prop signature stays stable. */
  readonly onOpenHistory: () => void
  /** Same — Dictionary opens from the Home pill row. */
  readonly onOpenDictionary: () => void
  readonly onResetOnboarding: () => void
}

/**
 * Top-level settings. Mirrors `SettingsShell` from `handoff_opennib/sources/settings.jsx`:
 * paper background, big serif-adjacent title, four chip tabs (General · Model ·
 * Keyboard · About), and scrollable sections per tab.
 *
 * History and Dictionary live on the Home pill row now (per the design), so
 * they don't appear as rows here even though the Shell still passes the
 * callbacks. The props are kept for backward compatibility with Shell.tsx.
 */
export function SettingsScreen({ onClose, onPickLanguage, onResetOnboarding }: Props) {
  const settings = useSettings()
  const [tab, setTab] = useState<SettingsTab>("general")

  if (!settings.ready) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  const titleFor = (t: SettingsTab): string =>
    t === "general" ? "General" : t === "model" ? "Model" : t === "kbd" ? "Keyboard" : "About"

  return (
    <SettingsShell tab={tab} title={titleFor(tab)} onClose={onClose} onChangeTab={setTab}>
      {tab === "general" && <GeneralTab />}
      {tab === "model" && <ModelTab onPickLanguage={onPickLanguage} />}
      {tab === "kbd" && <KeyboardTab onResetOnboarding={onResetOnboarding} />}
      {tab === "about" && <AboutTab />}
    </SettingsShell>
  )
}

// ─── General ─────────────────────────────────────────────────────────

function GeneralTab() {
  const settings = useSettings()
  // Haptics toggles are visually present per the M-S-1 design but not yet
  // persisted through the core Settings interface — they're driven by local
  // state for now so the row works in-session, and a follow-up wires
  // expo-haptics + the core flag through.
  const [hapticsOnTouch, setHapticsOnTouch] = useState(true)
  const [vibrateOnReady, setVibrateOnReady] = useState(true)
  if (!settings.ready) return null
  const { snapshot, setDictationSounds, setNotificationSounds } = settings

  return (
    <View style={{ gap: 18 }}>
      <Section title="Sounds">
        <SettingsRow
          title="Dictation sounds"
          right={
            <IOSToggle
              value={snapshot.dictationSounds}
              onValueChange={(v) => {
                void setDictationSounds(v)
              }}
            />
          }
        />
        <SettingsRow
          title="Notification sounds"
          right={
            <IOSToggle
              value={snapshot.notificationSounds}
              onValueChange={(v) => {
                void setNotificationSounds(v)
              }}
            />
          }
          last
        />
      </Section>
      <Section title="Haptics">
        <SettingsRow
          title="Haptics on touch"
          right={<IOSToggle value={hapticsOnTouch} onValueChange={setHapticsOnTouch} />}
        />
        <SettingsRow
          title="Vibrate when transcript ready"
          right={<IOSToggle value={vibrateOnReady} onValueChange={setVibrateOnReady} />}
          last
        />
      </Section>
    </View>
  )
}

// ─── Model + Language ────────────────────────────────────────────────

interface ModelTabProps {
  readonly onPickLanguage: () => void
}

/**
 * Tiny / Small / Medium are the three rungs the design surfaces inline on
 * mobile (matches MS2_Model in `handoff_opennib/sources/settings.jsx`).
 * Anything else in the WHISPER_MODELS catalog is still reachable via core's
 * registry — we just don't render it on the picker because three sizes are
 * what the design contract asks for.
 */
const MOBILE_MODEL_IDS = ["tiny", "small", "medium"] as const

const MOBILE_MODEL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  tiny: "Fastest. Good for quick notes.",
  small: "Recommended. Balanced speed + quality.",
  medium: "Slowest. Best with names and jargon.",
}

function ModelTab({ onPickLanguage }: ModelTabProps) {
  const settings = useSettings()
  // Whisper's translate-to-English task is in the design (M-S-2) but the
  // core transcription pipeline doesn't yet pipe a task flag through to
  // whisper.cpp. Local-state toggle holds the user's intent until the
  // pipeline wire-up lands.
  const [translateToEnglish, setTranslateToEnglish] = useState(false)
  if (!settings.ready) return null
  const { snapshot, setWhisperModelId } = settings
  const activeId = isWhisperModelId(snapshot.whisperModelId) ? snapshot.whisperModelId : "small"

  function selectModel(id: string): void {
    void setWhisperModelId(id)
  }

  return (
    <View style={{ gap: 18 }}>
      <Section title="Transcription">
        {MOBILE_MODEL_IDS.map((id, i) => {
          const model = WHISPER_MODELS[id]
          const isActive = id === activeId
          const isLast = i === MOBILE_MODEL_IDS.length - 1
          return (
            <Pressable
              key={id}
              onPress={() => selectModel(id)}
              disabled={isActive}
              style={({ pressed }) => [
                modelRowStyles.row,
                isActive && modelRowStyles.rowActive,
                !isLast && modelRowStyles.rowDivider,
                pressed && !isActive && modelRowStyles.rowPressed,
              ]}
            >
              <View style={[modelRowStyles.radio, isActive && modelRowStyles.radioActive]}>
                {isActive && <View style={modelRowStyles.radioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={modelRowStyles.titleLine}>
                  <Text style={modelRowStyles.name}>{id}</Text>
                  <Text style={modelRowStyles.size}>{describeBytes(model.approxSizeBytes)}</Text>
                </View>
                <Text style={modelRowStyles.desc}>{MOBILE_MODEL_DESCRIPTIONS[id]}</Text>
              </View>
              {isActive ? (
                <Chip tone="rec">Active</Chip>
              ) : (
                <View style={modelRowStyles.useButton}>
                  <Text style={modelRowStyles.useButtonLabel}>Use</Text>
                </View>
              )}
            </Pressable>
          )
        })}
      </Section>
      <View style={styles.help}>
        <Text style={styles.helpText}>
          Download a model, then tap <Text style={modelRowStyles.helpEmphasis}>Use</Text> to make it
          active. Runs on device.
        </Text>
      </View>
      <Section title="Language">
        <SettingsRow
          title="Language"
          value={describeLanguage(snapshot.language)}
          onPress={onPickLanguage}
          chevron
        />
        <SettingsRow
          title="Translate to English"
          right={<IOSToggle value={translateToEnglish} onValueChange={setTranslateToEnglish} />}
          last
        />
      </Section>
    </View>
  )
}

const modelRowStyles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowActive: {
    backgroundColor: "rgba(214,74,44,0.04)",
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.hair2,
  },
  rowPressed: {
    backgroundColor: tokens.paper2,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.2,
    borderColor: tokens.ink4,
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: {
    backgroundColor: tokens.ink,
    borderWidth: 0,
  },
  radioDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: tokens.paper,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  name: {
    fontSize: 15.5,
    fontWeight: "600",
    color: tokens.ink,
    letterSpacing: -0.2,
  },
  size: {
    fontFamily: monoFontFamily,
    fontSize: 11,
    color: tokens.ink3,
    letterSpacing: 0.5,
  },
  desc: {
    fontSize: 13,
    color: tokens.ink2,
    marginTop: 2,
  },
  useButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: tokens.ink,
  },
  useButtonLabel: {
    color: tokens.paper,
    fontSize: 13,
    fontWeight: "600",
  },
  helpEmphasis: {
    fontWeight: "600",
    color: tokens.ink2,
  },
})

// ─── Keyboard setup ──────────────────────────────────────────────────

interface KeyboardTabProps {
  readonly onResetOnboarding: () => void
}

function KeyboardTab({ onResetOnboarding }: KeyboardTabProps) {
  const keyboard = useKeyboardStatus()
  const permissions = usePermissions()
  const micOk = permissions.microphone === "granted"
  const keyboardOk = keyboard.everActivated === true
  const everythingOk = micOk && keyboardOk

  async function openKeyboardSettings(): Promise<void> {
    try {
      await Linking.openURL(KEYBOARD_SETTINGS_URL)
    } catch {
      await Linking.openSettings()
    }
  }

  return (
    <View style={{ gap: 18 }}>
      <View style={styles.statusCard}>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: everythingOk ? tokens.successSoft : tokens.recSoft },
          ]}
        >
          <Text
            style={[styles.statusBadgeText, { color: everythingOk ? tokens.success : tokens.rec }]}
          >
            {everythingOk ? "✓" : "!"}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusTitle}>
            {everythingOk ? "Everything is set up." : "One step left."}
          </Text>
          <Text style={styles.statusBody}>
            {everythingOk
              ? "The opennib keyboard is ready in every app."
              : "Finish keyboard setup so opennib can dictate everywhere."}
          </Text>
        </View>
      </View>

      <Section title="Status">
        <StatusRow
          title="Added to Keyboards"
          body={
            keyboardOk
              ? "opennib appears in Settings → General → Keyboard."
              : "Add opennib in Settings → General → Keyboard, then switch to it once."
          }
          ok={keyboardOk}
          onOpen={() => {
            void openKeyboardSettings()
          }}
        />
        {/* iOS doesn't expose hasFullAccess to the host app — only to the
            keyboard extension at runtime. We surface the requirement and let
            the user jump to Settings; the keyboard itself will error visibly
            if Full Access is off when the user tries to dictate. */}
        <StatusRow
          title="Full Access enabled"
          body="Required so opennib can insert text into other apps. Toggle on in Settings → opennib."
          ok={keyboardOk}
          onOpen={() => {
            void openKeyboardSettings()
          }}
        />
        <StatusRow
          title="Microphone allowed"
          body={
            micOk
              ? "Audio is processed on device and not stored."
              : "opennib needs microphone access. Grant it in Settings."
          }
          ok={micOk}
          last
          onOpen={() => {
            void Linking.openSettings()
          }}
        />
      </Section>
      <View style={styles.helpRow}>
        <InkButton
          variant="secondary"
          size="md"
          onPress={() => {
            void keyboard.refresh()
            void permissions.refresh()
          }}
        >
          Re-check status
        </InkButton>
      </View>
      <View style={styles.help}>
        <Text style={styles.helpText}>
          If iOS resets a permission after an update, come back here to fix it without poking
          through Settings.
        </Text>
      </View>

      <Section title="Setup">
        <SettingsRow
          title="Re-run setup"
          subtitle="Walk through the keyboard + permission flow again."
          onPress={onResetOnboarding}
          chevron
          last
        />
      </Section>
    </View>
  )
}

interface StatusRowProps {
  readonly title: string
  readonly body: string
  readonly ok: boolean
  readonly last?: boolean
  readonly onOpen?: () => void
}

function StatusRow({ title, body, ok, last = false, onOpen }: StatusRowProps) {
  return (
    <View style={[styles.statusRow, !last && styles.statusRowSeparator]}>
      <View style={[styles.statusDot, { backgroundColor: ok ? tokens.success : tokens.rec }]}>
        <Text style={styles.statusDotText}>{ok ? "✓" : "!"}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statusRowTitle}>{title}</Text>
        <Text style={styles.statusRowBody}>{body}</Text>
      </View>
      {!ok && onOpen !== undefined && (
        <InkButton
          variant="primary"
          size="sm"
          fullWidth={false}
          onPress={onOpen}
          style={{ paddingHorizontal: 14 }}
        >
          Open
        </InkButton>
      )}
    </View>
  )
}

// ─── About ───────────────────────────────────────────────────────────

function AboutTab() {
  return (
    <View style={{ gap: 18 }}>
      <View style={styles.aboutHero}>
        <NibTile size={64} radius={16} glyphSize={32} />
        <Wordmark size={28} />
        <Text style={styles.aboutVersion}>v0.8 · MIT licensed</Text>
      </View>

      <View style={styles.privacyCard}>
        <Text style={styles.privacyText}>
          Everything happens on this device. Audio, transcripts, and the dictionary never leave this
          phone. <Text style={styles.privacyBold}>No telemetry, no cloud, no servers.</Text>
        </Text>
      </View>

      <Section title="What this guarantees">
        <PrivacyBullet
          title="Stays on this phone"
          body="The transcription model runs locally. No cloud APIs, no remote inference, no audio uploads — ever."
        />
        <PrivacyBullet
          title="Offline after the first download"
          body="The only outbound request is the one-time model download. After that, opennib is fully offline."
        />
        <PrivacyBullet
          title="No analytics, no telemetry"
          body="Nothing is sent anywhere about what you say, when, or how often."
          last
        />
      </Section>

      <Section>
        <SettingsRow
          title="View source on GitHub"
          chevron
          onPress={() => {
            void Linking.openURL("https://github.com/opennib/mobile")
          }}
        />
        <SettingsRow
          title="Report an issue"
          chevron
          onPress={() => {
            void Linking.openURL("https://github.com/opennib/mobile/issues/new")
          }}
          last
        />
      </Section>
    </View>
  )
}

function PrivacyBullet({
  title,
  body,
  last = false,
}: {
  readonly title: string
  readonly body: string
  readonly last?: boolean
}) {
  return (
    <View style={[styles.bulletRow, !last && styles.bulletRowSeparator]}>
      <View style={styles.bulletCheck}>
        <Text style={styles.bulletCheckText}>✓</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.bulletTitle}>{title}</Text>
        <Text style={styles.bulletBody}>{body}</Text>
      </View>
    </View>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────

function describeLanguage(tag: string): string {
  if (!isSupportedLanguage(tag)) return tag
  const entry = SUPPORTED_LANGUAGES.find((l) => l.tag === tag)
  if (entry === undefined) return tag
  if (entry.tag === "auto") return "Auto-detect"
  return entry.displayName
}

function describeBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`
  return `${bytes} B`
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.paper,
  },
  loadingText: { color: tokens.ink3, fontSize: 14 },
  help: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  helpText: {
    fontSize: 12,
    color: tokens.ink3,
    lineHeight: 17,
  },
  helpRow: {
    paddingHorizontal: 16,
  },

  // Keyboard tab status block
  statusCard: {
    marginHorizontal: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    backgroundColor: tokens.card,
  },
  statusBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadgeText: {
    fontSize: 17,
    fontWeight: "700",
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.ink,
    letterSpacing: -0.2,
  },
  statusBody: {
    fontSize: 13,
    color: tokens.ink2,
    marginTop: 2,
    lineHeight: 18,
  },
  statusRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  statusRowSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.hair2,
  },
  statusDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  statusRowTitle: {
    fontSize: 14.5,
    fontWeight: "500",
    color: tokens.ink,
    letterSpacing: -0.2,
  },
  statusRowBody: {
    fontSize: 12.5,
    color: tokens.ink2,
    marginTop: 2,
    lineHeight: 17,
  },

  // About tab
  aboutHero: {
    paddingHorizontal: 24,
    paddingBottom: 22,
    alignItems: "center",
    gap: 10,
  },
  aboutVersion: {
    fontFamily: monoFontFamily,
    fontSize: 11,
    color: tokens.ink3,
    letterSpacing: 0.6,
  },
  privacyCard: {
    marginHorizontal: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: tokens.card,
  },
  privacyText: {
    fontSize: 14.5,
    color: tokens.ink,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  privacyBold: {
    fontWeight: "600",
  },
  bulletRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  bulletRowSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.hair2,
  },
  bulletCheck: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: tokens.paper2,
    alignItems: "center",
    justifyContent: "center",
  },
  bulletCheckText: {
    color: tokens.success,
    fontWeight: "700",
  },
  bulletTitle: {
    fontSize: 14.5,
    fontWeight: "600",
    color: tokens.ink,
    letterSpacing: -0.2,
  },
  bulletBody: {
    fontSize: 12.5,
    color: tokens.ink2,
    marginTop: 2,
    lineHeight: 18,
  },
})
