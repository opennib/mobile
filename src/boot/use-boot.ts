import { useEffect, useState } from "react"
import { Paths } from "expo-file-system"
import AsyncStorage from "@react-native-async-storage/async-storage"

import { bareWorker } from "../native/bare-worker"
import { AsyncStorageSettings } from "../services/async-storage-settings"
import { BareHistory } from "../services/bare-history"
import { BareDictionary } from "../services/bare-dictionary"
import { OnboardingState } from "../services/onboarding-state"

export interface BootState {
  readonly settings: AsyncStorageSettings
  readonly history: BareHistory
  readonly dictionary: BareDictionary
  readonly onboarding: OnboardingState
  readonly onboardingCompleted: boolean
}

export interface BootResult {
  readonly boot: BootState | null
  readonly bootError: string | null
}

/**
 * One-shot boot orchestration: starts the Bare worker (Hypercore lives there
 * since Hermes can't host it), constructs the settings/history/dictionary
 * adapters that talk to it, and loads their initial state in parallel.
 *
 * Returns `{ boot: null, bootError: null }` while in-flight, `{ boot: null,
 * bootError: <msg> }` on failure, and the booted services on success. The
 * caller decides what to render in each phase.
 */
export function useBoot(): BootResult {
  const [boot, setBoot] = useState<BootState | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    const settings = new AsyncStorageSettings({ storage: AsyncStorage })
    const history = new BareHistory()
    const dictionary = new BareDictionary()
    const onboarding = new OnboardingState({ storage: AsyncStorage })
    let cancelled = false
    void (async () => {
      try {
        const baseDir = Paths.document.uri.replace(/^file:\/\//, "")
        console.info("[boot] starting bare worker", { baseDir })
        await bareWorker.start({
          historyDir: `${baseDir}opennib-history`,
          dictionaryDir: `${baseDir}opennib-dictionary`,
          sdkHomeDir: baseDir,
        })
        console.info("[boot] bare worker ready, loading state")
        const [, , , snapshot] = await Promise.all([
          settings.load(),
          history.load(),
          dictionary.load(),
          onboarding.load(),
        ])
        console.info("[boot] state loaded")
        if (!cancelled) {
          setBoot({
            settings,
            history,
            dictionary,
            onboarding,
            onboardingCompleted: snapshot.completed,
          })
        }
      } catch (e) {
        console.error("[boot] failed", e)
        if (!cancelled) setBootError(formatErrorChain(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { boot, bootError }
}

/**
 * Walks an Error chain via `.cause`, flattening the messages into a single
 * arrow-separated string so the boot screen shows the underlying failure
 * (e.g. "BootError: bare worker init failed → RpcError: timeout").
 */
function formatErrorChain(e: unknown): string {
  const parts: string[] = []
  let cur: unknown = e
  for (let depth = 0; depth < 6 && cur !== undefined && cur !== null; depth++) {
    if (cur instanceof Error) {
      parts.push(`${cur.name}: ${cur.message}`)
      cur = (cur as Error & { cause?: unknown }).cause
    } else {
      parts.push(String(cur))
      break
    }
  }
  return parts.join(" → ")
}
