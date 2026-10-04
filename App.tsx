import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"

import { useBoot } from "./src/boot/use-boot"
import { Shell } from "./src/Shell"
import { SettingsContext } from "./src/hooks/use-settings"
import { HistoryContext } from "./src/hooks/use-history"
import { DictionaryContext } from "./src/hooks/use-dictionary"

export function App() {
  const { boot, bootError } = useBoot()

  if (boot === null) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.boot}>
          <StatusBar style="auto" />
          {bootError === null ? (
            <ActivityIndicator color="#3366cc" />
          ) : (
            <View style={styles.bootErrorContainer}>
              <Text style={styles.bootErrorText}>Boot failed: {bootError}</Text>
            </View>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    )
  }

  // SafeAreaProvider supplies real system-bar insets on Android, where the app
  // draws edge-to-edge and React Native's own SafeAreaView is a plain View.
  return (
    <SafeAreaProvider>
      <SettingsContext.Provider value={boot.settings}>
        <HistoryContext.Provider value={boot.history}>
          <DictionaryContext.Provider value={boot.dictionary}>
            <Shell
              onboarding={boot.onboarding}
              initialOnboardingCompleted={boot.onboardingCompleted}
            />
          </DictionaryContext.Provider>
        </HistoryContext.Provider>
      </SettingsContext.Provider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  bootErrorContainer: { paddingHorizontal: 20 },
  bootErrorText: { color: "#c14545", fontSize: 14, textAlign: "center" },
})
