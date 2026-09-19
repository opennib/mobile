import { createContext, useContext, useEffect, useState } from "react"

import type {
  AsyncStorageSettings,
  MobileSettingsSnapshot,
} from "../services/async-storage-settings"

/**
 * Provided by `App.tsx` after `AsyncStorageSettings.load()` resolves so
 * children never see an unloaded store. `null` is the pre-hydration sentinel
 * — `useSettings()` returns it during the first frame and consumers gate
 * their UI on it.
 *
 * Typed as the concrete `AsyncStorageSettings` (not core's `Settings`) because
 * the UI reads the combined dictation + host view (`appSnapshot`) and needs
 * the host setters (sound toggles) core's interface no longer exposes.
 */
export const SettingsContext = createContext<AsyncStorageSettings | null>(null)

interface UseSettingsReady {
  readonly ready: true
  readonly snapshot: MobileSettingsSnapshot
  setLanguage(tag: string): Promise<void>
  setWhisperModelId(id: string): Promise<void>
  setCleanupEnabled(enabled: boolean): Promise<void>
  setLlmModelId(id: string | null): Promise<void>
  setDictationSounds(value: boolean): Promise<void>
  setNotificationSounds(value: boolean): Promise<void>
}

interface UseSettingsPending {
  readonly ready: false
}

export type UseSettings = UseSettingsReady | UseSettingsPending

/**
 * Read + mutate the settings snapshot from React. Subscribes to `onChange`
 * so any setter call (from this hook or anywhere else) keeps the UI in sync
 * without an explicit refresh.
 */
export function useSettings(): UseSettings {
  const settings = useContext(SettingsContext)
  const [snapshot, setSnapshot] = useState<MobileSettingsSnapshot | null>(
    settings === null ? null : settings.appSnapshot(),
  )

  useEffect(() => {
    if (settings === null) return
    setSnapshot(settings.appSnapshot())
    return settings.onAppChange((next) => setSnapshot(next))
  }, [settings])

  if (settings === null || snapshot === null) {
    return { ready: false }
  }

  return {
    ready: true,
    snapshot,
    setLanguage: (tag) => settings.setLanguage(tag),
    setWhisperModelId: (id) => settings.setWhisperModelId(id),
    setCleanupEnabled: (enabled) => settings.setCleanupEnabled(enabled),
    setLlmModelId: (id) => settings.setLlmModelId(id),
    setDictationSounds: (value) => settings.setDictationSounds(value),
    setNotificationSounds: (value) => settings.setNotificationSounds(value),
  }
}
