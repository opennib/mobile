import { useCallback, useState } from "react"
import { SafeAreaView, StyleSheet } from "react-native"
import { StatusBar } from "expo-status-bar"

import type { OnboardingState } from "./services/onboarding-state"
import { useCleanerConfig } from "./hooks/use-cleaner-config"
import { SettingsScreen } from "./screens/SettingsScreen"
import { LanguagePickerScreen } from "./screens/LanguagePickerScreen"
import { HistoryScreen } from "./screens/HistoryScreen"
import { DictionaryScreen } from "./screens/DictionaryScreen"
import { OnboardingNavigator } from "./onboarding/OnboardingNavigator"
import { HomeScreen } from "./screens/HomeScreen"

type Screen = "home" | "settings" | "language-picker" | "history" | "dictionary"

export interface ShellProps {
  readonly onboarding: OnboardingState
  readonly initialOnboardingCompleted: boolean
}

/**
 * Top-level screen router. Gates on onboarding completion, then switches
 * between the home dictation surface and the settings stack. Each non-home
 * screen renders inside its own SafeAreaView so the StatusBar styling stays
 * scoped per screen.
 */
export function Shell({ onboarding, initialOnboardingCompleted }: ShellProps) {
  // Keep the worker's LLM cleaner in sync with cleanup settings for as long as
  // the app is mounted (Shell outlives every screen). Currently a no-op on
  // device — cleanup is blocked pending a usable SDK registry constant.
  useCleanerConfig()
  const [completed, setCompleted] = useState(initialOnboardingCompleted)
  const [screen, setScreen] = useState<Screen>("home")
  // History + Dictionary can be reached from either Home (chips in the
  // header) or Settings (rows inside the sheet). Track the parent so the
  // back button returns there instead of always dumping the user into
  // Settings.
  const [historyParent, setHistoryParent] = useState<"home" | "settings">("home")
  const [dictionaryParent, setDictionaryParent] = useState<"home" | "settings">("home")
  const goHome = useCallback(() => setScreen("home"), [])

  if (!completed) {
    return (
      <OnboardingNavigator
        onComplete={() => {
          void onboarding.markCompleted().then(() => setCompleted(true))
        }}
      />
    )
  }

  if (screen === "settings") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="auto" />
        <SettingsScreen
          onClose={goHome}
          onPickLanguage={() => setScreen("language-picker")}
          onOpenHistory={() => {
            setHistoryParent("settings")
            setScreen("history")
          }}
          onOpenDictionary={() => {
            setDictionaryParent("settings")
            setScreen("dictionary")
          }}
          onResetOnboarding={() => {
            void onboarding.reset().then(() => setCompleted(false))
          }}
        />
      </SafeAreaView>
    )
  }
  if (screen === "language-picker") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="auto" />
        <LanguagePickerScreen onClose={() => setScreen("settings")} />
      </SafeAreaView>
    )
  }
  if (screen === "history") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="auto" />
        <HistoryScreen onClose={() => setScreen(historyParent)} />
      </SafeAreaView>
    )
  }
  if (screen === "dictionary") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="auto" />
        <DictionaryScreen onClose={() => setScreen(dictionaryParent)} />
      </SafeAreaView>
    )
  }
  return (
    <HomeScreen
      onOpenSettings={() => setScreen("settings")}
      onOpenHistory={() => {
        setHistoryParent("home")
        setScreen("history")
      }}
      onOpenDictionary={() => {
        setDictionaryParent("home")
        setScreen("dictionary")
      }}
    />
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 12, backgroundColor: "#ffffff" },
})
