import { useCallback, useEffect, useState } from "react"
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { StatusBar } from "expo-status-bar"
import { SafeAreaView } from "react-native-safe-area-context"
import Svg, { Path } from "react-native-svg"

import { useKeyboardStatus } from "../hooks/use-keyboard-status"
import { usePermissions } from "../hooks/use-permissions"
import { NibGlyph, NibTile, Wordmark } from "../components/Brand"
import { MicButton } from "../components/MicButton"
import { NoticeCard } from "../components/NoticeCard"
import { Eyebrow, InkButton } from "../components/ui"
import { monoFontFamily, tokens } from "../theme/tokens"

type StepKey = "welcome" | "mic-permission" | "keyboard-install" | "done"
const STEPS: readonly StepKey[] = ["welcome", "mic-permission", "keyboard-install", "done"]

interface Props {
  readonly onComplete: () => void
}

/**
 * Mobile first-run flow — Welcome → Mic → Keyboard → Done. Matches the M-O-*
 * frames in `handoff_opennib/sources/onboarding.jsx`: paper background, nib
 * tile + wordmark hero on welcome, mic halo on the permission step, iOS
 * Keyboards preview on the keyboard step, green ✓ + "Nicely done" on done.
 *
 * Auto-advances when permission or keyboard activation flips to granted/true
 * (mirrors the old behavior) so a returning user doesn't have to tap twice.
 */
export function OnboardingNavigator({ onComplete }: Props) {
  const [index, setIndex] = useState(0)
  const step = STEPS[index] ?? "welcome"

  const next = useCallback(() => {
    setIndex((prev) => Math.min(prev + 1, STEPS.length - 1))
  }, [])
  const back = useCallback(() => {
    setIndex((prev) => Math.max(prev - 1, 0))
  }, [])

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step === "welcome" && <WelcomeStep onContinue={next} />}
        {step === "mic-permission" && <MicStep onContinue={next} onBack={back} />}
        {step === "keyboard-install" && <KeyboardStep onContinue={next} onBack={back} />}
        {step === "done" && <DoneStep onComplete={onComplete} />}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── M-O-1 · Welcome ────────────────────────────────────────────────

function WelcomeStep({ onContinue }: { readonly onContinue: () => void }) {
  return (
    <View style={styles.stepInner}>
      <View style={styles.welcomeCenter}>
        <NibTile size={84} radius={22} glyphSize={42} />
        <View style={styles.welcomeCopy}>
          <Eyebrow>Free · Private · Local</Eyebrow>
          <View style={{ marginTop: 12 }}>
            <Wordmark size={42} />
          </View>
          <Text style={styles.welcomeLead}>
            Dictate anywhere on your phone. Voice and text never leave it — no accounts, no cloud,
            no tracking.
          </Text>
        </View>
        <View style={styles.bulletColumn}>
          {(
            [
              ["On device", "Runs locally. Audio never leaves this phone."],
              ["No account", "No sign-up. No telemetry. No background usage."],
              ["Open source", "MIT licensed. Inspect every line on GitHub."],
            ] as const
          ).map(([title, body]) => (
            <View key={title} style={styles.bullet}>
              <View style={styles.bulletCheck}>
                <Svg width={13} height={13} viewBox="0 0 14 14" fill="none">
                  <Path
                    d="M3 7.2l2.4 2.4L11 4.4"
                    stroke={tokens.rec}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bulletTitle}>{title}</Text>
                <Text style={styles.bulletBody}>{body}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        <InkButton variant="primary" trailing="→" onPress={onContinue}>
          Get started
        </InkButton>
      </View>
    </View>
  )
}

// ─── M-O-2 · Microphone ─────────────────────────────────────────────

interface StepProps {
  readonly onContinue: () => void
  readonly onBack: () => void
}

function MicStep({ onContinue, onBack }: StepProps) {
  const permissions = usePermissions()
  const status = permissions.microphone

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void permissions.refresh()
    })
    return () => sub.remove()
  }, [permissions])

  useEffect(() => {
    if (status === "granted") onContinue()
  }, [status, onContinue])

  async function handlePress(): Promise<void> {
    if (status === "denied") {
      await Linking.openSettings()
      return
    }
    if (status === "undetermined") {
      const nextStatus = await permissions.requestMicrophone()
      if (nextStatus === "granted") onContinue()
    }
  }

  const denied = status === "denied"
  const loading = status === "loading"

  return (
    <View style={styles.stepInner}>
      <View style={styles.stepBody}>
        <Eyebrow>Permission · Microphone</Eyebrow>
        <Text style={styles.title}>
          {denied ? "Re-enable mic for opennib." : "Let opennib hear you."}
        </Text>
        <Text style={styles.body}>
          {denied
            ? "You previously declined. Open Settings, turn Microphone on for opennib, and come back."
            : "opennib records only while you hold the mic button. Audio is processed on this phone — nothing leaves it."}
        </Text>
      </View>

      <View style={styles.micHalo}>
        <View style={[styles.haloRing, { width: 240, height: 240, opacity: 0.45 }]} />
        <View style={[styles.haloRing, { width: 290, height: 290, opacity: 0.3 }]} />
        <View style={[styles.haloRing, { width: 340, height: 340, opacity: 0.15 }]} />
        <MicButton size={110} state={denied ? "disabled" : "idle"} />
      </View>

      <View style={styles.actions}>
        {denied && (
          <View style={styles.micNotice}>
            <NoticeCard
              tone="warn"
              title="Microphone blocked"
              body="Settings ▸ opennib ▸ Microphone"
            />
          </View>
        )}
        <InkButton
          variant="primary"
          onPress={() => {
            void handlePress()
          }}
          disabled={loading}
        >
          {denied ? "Open Settings" : loading ? "Asking…" : "Allow microphone"}
        </InkButton>
        {!denied && !loading && (
          <InkButton variant="ghost" size="md" onPress={onContinue}>
            Not now
          </InkButton>
        )}
        <BackLink onPress={onBack} />
      </View>
    </View>
  )
}

// ─── M-O-3 · Keyboard install ───────────────────────────────────────

/**
 * iOS: one stage — add opennib under Keyboards and switch to it once.
 * Android: two stages — enable opennib in the system keyboard list, then pick
 * it in the keyboard chooser so it becomes the default.
 */
function KeyboardStep({ onContinue, onBack }: StepProps) {
  const keyboard = useKeyboardStatus()
  const [busy, setBusy] = useState(false)
  const android = Platform.OS === "android"
  const stage: "enable" | "switch" | "ios" = !android
    ? "ios"
    : keyboard.enabled === true
      ? "switch"
      : "enable"
  const waiting = !android && keyboard.ready === false

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void keyboard.refresh()
    })
    return () => sub.remove()
  }, [keyboard])

  useEffect(() => {
    if (keyboard.ready === true) onContinue()
  }, [keyboard.ready, onContinue])

  async function handlePrimary(): Promise<void> {
    setBusy(true)
    try {
      if (stage === "switch") await keyboard.showPicker()
      else await keyboard.openSettings()
    } finally {
      setBusy(false)
    }
  }

  const copy = {
    ios: {
      eyebrow: "Step · Keyboard",
      title: waiting ? "Almost there." : "Set up the opennib keyboard.",
      body: waiting
        ? "We can't see opennib in your keyboards yet. Add it, then switch to it once in any text field to wake it."
        : "Add opennib in Settings and turn on Full Access — it's required to run the model on this phone.",
      button: "Open Settings",
    },
    enable: {
      eyebrow: "Step 1 of 2 · Keyboard",
      title: "Turn on the opennib keyboard.",
      body: "Android lists keyboards in system settings. Switch opennib on there and come back. Android shows the same warning for every third-party keyboard; opennib never sends what you type anywhere.",
      button: "Open keyboard settings",
    },
    switch: {
      eyebrow: "Step 2 of 2 · Keyboard",
      title: "Make opennib your keyboard.",
      body: "Pick opennib in the chooser. You can switch back any time from the keyboard icon at the bottom of the screen.",
      button: busy ? "Waiting…" : "Choose keyboard",
    },
  }[stage]

  return (
    <View style={styles.stepInner}>
      <View style={styles.stepBody}>
        <Eyebrow>{copy.eyebrow}</Eyebrow>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
      </View>

      <View style={styles.kbPreviewWrap}>
        {waiting ? (
          <NoticeCard
            tone="warn"
            title="Not detected yet"
            body="Add opennib AND switch to it once for it to wake."
          />
        ) : stage === "ios" ? (
          <IOSKbPreview />
        ) : stage === "enable" ? (
          <AndroidEnablePreview />
        ) : (
          <AndroidPickerPreview />
        )}
      </View>

      <View style={styles.actions}>
        <InkButton
          variant="primary"
          disabled={busy}
          onPress={() => {
            void handlePrimary()
          }}
        >
          {copy.button}
        </InkButton>
        <InkButton variant="ghost" size="md" onPress={onContinue}>
          Skip for now
        </InkButton>
        <BackLink onPress={onBack} />
      </View>
    </View>
  )
}

function KeyboardGlyph() {
  return (
    <Svg width={15} height={15} viewBox="0 0 16 16" fill="none">
      <Path
        d="M1.5 4h13v8h-13zM4 6.5h.01M6 6.5h.01M8 6.5h.01M10 6.5h.01M12 6.5h.01M4.5 9.5h7"
        stroke={tokens.ink2}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </Svg>
  )
}

/** Inline "Keyboards" preview card — matches the IOSKbPreview in onboarding.jsx. */
function IOSKbPreview() {
  return (
    <View style={styles.kbCard}>
      <PreviewRow icon={<KeyboardGlyph />} label="Keyboards" chevron />
      <PreviewRow icon={<NibGlyph size={14} color={tokens.ink} />} label="opennib" toggleOn />
      <PreviewRow
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16" fill="none">
            <Path
              d="M3.5 7h9v6.5h-9zM5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"
              stroke={tokens.ink2}
              strokeWidth={1.2}
              strokeLinecap="round"
            />
          </Svg>
        }
        label="Allow Full Access"
        toggleOn
        last
      />
      <Text style={styles.kbHint}>Settings ▸ General ▸ Keyboard ▸ Keyboards</Text>
    </View>
  )
}

/** Android system keyboard list with opennib switched on. */
function AndroidEnablePreview() {
  return (
    <View style={styles.kbCard}>
      <PreviewRow icon={<KeyboardGlyph />} label="On-screen keyboards" chevron />
      <PreviewRow icon={<NibGlyph size={14} color={tokens.ink} />} label="opennib" toggleOn last />
      <Text style={styles.kbHint}>
        Settings ▸ Keyboard ▸ On-screen keyboards (name varies by phone)
      </Text>
    </View>
  )
}

/** Android keyboard chooser with opennib selected. */
function AndroidPickerPreview() {
  return (
    <View style={styles.kbCard}>
      <PreviewRow icon={<KeyboardGlyph />} label="Choose keyboard" />
      <PreviewRow icon={<NibGlyph size={14} color={tokens.ink} />} label="opennib" selected last />
      <Text style={styles.kbHint}>Tap “Choose keyboard” below, then pick opennib</Text>
    </View>
  )
}

function PreviewRow({
  icon,
  label,
  toggleOn,
  selected,
  chevron,
  last,
}: {
  readonly icon: React.ReactNode
  readonly label: string
  readonly toggleOn?: boolean
  readonly selected?: boolean
  readonly chevron?: boolean
  readonly last?: boolean
}) {
  return (
    <View style={[styles.previewRow, !last && styles.previewRowSeparator]}>
      <View style={styles.previewIcon}>{icon}</View>
      <Text style={styles.previewLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      {toggleOn === true && (
        <View style={styles.previewToggle}>
          <View style={styles.previewToggleKnob} />
        </View>
      )}
      {selected === true && (
        <View style={styles.previewRadio}>
          <View style={styles.previewRadioDot} />
        </View>
      )}
      {chevron === true && <Text style={styles.previewChevron}>›</Text>}
    </View>
  )
}

// ─── M-O-4 · Done ───────────────────────────────────────────────────

function DoneStep({ onComplete }: { readonly onComplete: () => void }) {
  return (
    <View style={styles.stepInner}>
      <View style={styles.doneCenter}>
        <View style={styles.doneCheck}>
          <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
            <Path
              d="M5 12.5l4.5 4.5L19 7"
              stroke="#fff"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <Text style={styles.doneTitle}>Nicely done.</Text>
        <Text style={styles.doneBody}>
          {Platform.OS === "android"
            ? "You can dictate anywhere — open any text field, then hold the mic on the opennib keyboard."
            : "You can dictate anywhere — tap the 🌐 globe key in any app, then hold the mic."}
        </Text>
      </View>
      <View style={styles.actions}>
        <InkButton variant="primary" onPress={onComplete}>
          Start using opennib
        </InkButton>
      </View>
    </View>
  )
}

function BackLink({ onPress }: { readonly onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.backLink, pressed && { opacity: 0.5 }]}
      onPress={onPress}
    >
      <Text style={styles.backLinkLabel}>← Back</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.paper },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, paddingTop: 16 },
  stepInner: {
    flex: 1,
    minHeight: 600,
    justifyContent: "space-between",
  },
  stepBody: { paddingTop: 24 },
  actions: { paddingTop: 24, gap: 8 },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: tokens.ink,
    letterSpacing: -0.7,
    lineHeight: 34,
    marginTop: 14,
    marginBottom: 12,
  },
  body: {
    fontSize: 14.5,
    color: tokens.ink2,
    lineHeight: 21,
  },

  // Welcome
  welcomeCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 24,
    gap: 22,
  },
  welcomeCopy: {
    alignItems: "center",
    paddingHorizontal: 12,
  },
  welcomeLead: {
    marginTop: 12,
    fontSize: 16.5,
    lineHeight: 23,
    color: tokens.ink2,
    letterSpacing: -0.2,
    textAlign: "center",
    maxWidth: 300,
  },
  bulletColumn: {
    width: "100%",
    paddingHorizontal: 8,
    gap: 14,
    marginTop: 8,
  },
  bullet: {
    flexDirection: "row",
    gap: 12,
  },
  bulletCheck: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: tokens.recSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  bulletTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.ink,
    letterSpacing: -0.2,
  },
  bulletBody: {
    fontSize: 14,
    color: tokens.ink2,
    lineHeight: 19,
    marginTop: 2,
  },

  // Mic
  micHalo: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    position: "relative",
  },
  haloRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: tokens.hair,
  },
  micNotice: { marginBottom: 8 },

  // Keyboard preview
  kbPreviewWrap: {
    paddingVertical: 20,
    gap: 14,
  },
  kbCard: {
    backgroundColor: tokens.card,
    borderRadius: 14,
    overflow: "hidden",
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
    backgroundColor: "#fff",
  },
  previewRowSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.hair2,
  },
  previewIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: tokens.paper2,
    alignItems: "center",
    justifyContent: "center",
  },
  previewLabel: {
    fontSize: 14,
    color: tokens.ink,
    letterSpacing: -0.2,
  },
  previewRadio: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: tokens.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  previewRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: tokens.ink,
  },
  previewToggle: {
    width: 38,
    height: 23,
    borderRadius: 999,
    backgroundColor: tokens.iosGreen,
    padding: 2,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  previewToggleKnob: {
    width: 19,
    height: 19,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  previewChevron: {
    fontSize: 20,
    color: tokens.ink4,
    marginRight: 2,
  },
  kbHint: {
    fontFamily: monoFontFamily,
    fontSize: 11,
    color: tokens.ink3,
    paddingHorizontal: 14,
    paddingVertical: 10,
    letterSpacing: 0.1,
  },

  // Done
  doneCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    gap: 18,
  },
  doneCheck: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: tokens.iosGreen,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: tokens.iosGreen,
    shadowOpacity: 0.35,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  doneTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: tokens.ink,
    letterSpacing: -0.6,
  },
  doneBody: {
    fontSize: 15,
    color: tokens.ink2,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 290,
  },

  backLink: { paddingVertical: 12, alignItems: "center" },
  backLinkLabel: { color: tokens.ink3, fontSize: 13, fontWeight: "500" },
})
