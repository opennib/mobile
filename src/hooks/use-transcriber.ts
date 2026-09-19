import { useEffect, useRef, useState } from "react"

import { bareWorker } from "../native/bare-worker"

export type TranscriberStatus = "idle" | "loading" | "ready" | "transcribing" | "error"

interface UseTranscriberOptions {
  /** From `Settings.whisperModelId()`. Reloading the model is automatic when this changes. */
  readonly whisperModelId: string
  /** From `Settings.language()`. `"auto"` lets Whisper detect, anything else is forwarded as-is. */
  readonly language: string
}

interface UseTranscriber {
  readonly status: TranscriberStatus
  readonly progress: number | null
  readonly error: string | null
  /**
   * Run one dictation cycle in the worker on a previously-recorded 16 kHz
   * mono WAV: speech gate → whisper → cleanup → history append. Resolves to
   * the final text, or "" when the recording had no speech. Throws if the
   * model isn't loaded yet.
   */
  transcribe(wavPath: string): Promise<string>
}

/**
 * Drives whisper (and the optional LLM cleanup pass) that now live INSIDE the
 * opennib Bare worker — this hook is a thin RPC client. `whisperModelId` and
 * `language` come from settings; both trigger a `MODEL_LOAD` in the worker
 * (status flips back to `loading`) because whisper.cpp bakes `language` in at
 * load time, so a runtime switch only takes effect after a reload. The f32le
 * / GPU-off invariants and the model-id → SDK-constant mapping live in the
 * worker (`bare/index.mjs`), shared with desktop via `buildWhisperModelConfig`.
 */
export function useTranscriber({
  whisperModelId,
  language,
}: UseTranscriberOptions): UseTranscriber {
  const [status, setStatus] = useState<TranscriberStatus>("idle")
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const readyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    readyRef.current = false

    // Progress ticks are pushed from the worker (EVENT_MODEL_PROGRESS) during
    // the download/load. We only surface ticks for the model this effect is
    // loading; a stale tick from a superseded load is ignored via `cancelled`.
    const unsubscribe = bareWorker.onModelProgress((event) => {
      if (!cancelled && event.model === whisperModelId) setProgress(event.percent)
    })

    async function load(): Promise<void> {
      try {
        setStatus("loading")
        setProgress(null)
        setError(null)
        await bareWorker.modelLoad(whisperModelId, language)
        if (cancelled) return
        readyRef.current = true
        setStatus("ready")
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e))
          setStatus("error")
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [whisperModelId, language])

  async function transcribe(wavPath: string): Promise<string> {
    if (!readyRef.current) throw new Error("whisper model not loaded")
    setStatus("transcribing")
    try {
      const text = await bareWorker.dictate(wavPath, whisperModelId, language)
      setStatus("ready")
      return text ?? ""
    } catch (e) {
      setStatus("ready")
      throw e
    }
  }

  return { status, progress, error, transcribe }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
