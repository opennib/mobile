import { useEffect, useRef } from "react"

import { DEFAULT_LLM_MODEL_ID, ModelLoadError, log } from "@opennib/core"

import { bareWorker } from "../native/bare-worker"
import { useSettings } from "./use-settings"

/**
 * Keeps the worker's LLM cleaner in sync with the user's cleanup settings.
 * On mount and whenever `cleanupEnabled` / `llmModelId` change, it sends
 * `CLEANER_CONFIGURE` with the resolved model id (or `null` to turn cleanup
 * off).
 *
 * Cleanup is currently BLOCKED on mobile: the @qvac/sdk registry ships no
 * Qwen2.5 instruct constant for our catalog ids (only the Qwen3 family), so
 * the worker rejects a configure with a typed `ModelLoadError`. That's the
 * expected steady state today — we log it once at info level and never crash
 * the app over it. The wiring stays in place so re-enabling cleanup is a
 * worker-only change once a usable constant (or a modelPath download) lands.
 */
export function useCleanerConfig(): void {
  const settings = useSettings()
  const cleanupEnabled = settings.ready ? settings.snapshot.cleanupEnabled : false
  const llmModelId = settings.ready ? settings.snapshot.llmModelId : null
  const blockLogged = useRef(false)

  useEffect(() => {
    if (!settings.ready) return
    let cancelled = false
    const modelPath = cleanupEnabled ? (llmModelId ?? DEFAULT_LLM_MODEL_ID) : null

    void (async () => {
      try {
        await bareWorker.cleanerConfigure(modelPath)
      } catch (err) {
        if (cancelled) return
        // Expected while cleanup is blocked (no matching SDK registry constant):
        // log once at info level. Anything else is a real failure worth a warn.
        if (err instanceof ModelLoadError) {
          if (!blockLogged.current) {
            blockLogged.current = true
            log.info("LLM cleanup unavailable on mobile", { reason: err.message })
          }
          return
        }
        log.warn("cleaner configure failed", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [settings.ready, cleanupEnabled, llmModelId])
}
