import { Worklet } from "react-native-bare-kit"

import {
  OpennibError,
  log,
  type DictionaryEntry,
  type HistoryListOptions,
  type TranscriptEntry,
} from "@opennib/core"
import HRPC from "@opennib/core/hrpc"
import type { HrpcError, HrpcModelProgress, HrpcTextResponse } from "@opennib/core/hrpc"
import { rehydrateError } from "@opennib/core/rpc"

// Base64 of the binary bare-pack bundle (see scripts/bundle-bare.mjs for why
// it is not shipped as a raw source string).
import workerBundleBase64 from "../../bare/worker.bundle.cjs"

export interface BareWorkerInitOptions {
  /** Filesystem path where Hypercore writes the transcript history log. */
  readonly historyDir: string
  /** Filesystem path where Hypercore writes the dictionary event log. */
  readonly dictionaryDir: string
  /**
   * Writable app-sandbox directory the SDK uses as its home (`.qvac/` model
   * cache + registry corestore live under it). Under BareKit the SDK derives
   * HOME from the worklet's argv, not the process env — without this, model
   * downloads land on an unwritable path and every load fails.
   */
  readonly sdkHomeDir: string
}

/** Handler for worker → host model-download/load progress ticks. */
export type ModelProgressHandler = (event: HrpcModelProgress) => void

/**
 * Throw the matching `OpennibError` subclass when the worker returned an error
 * envelope, otherwise return the response. One helper so every typed call
 * unwraps the generated HRPC contract identically.
 */
function unwrap<T extends { readonly error: HrpcError | null }>(res: T): T {
  if (res.error !== null) throw rehydrateError(res.error.name, res.error.message)
  return res
}

/**
 * Hermes-side handle to the opennib-owned Bare worker. Mounts the worklet via
 * react-native-bare-kit, opens the generated typed HRPC channel over its IPC
 * stream, and exposes typed methods for adapters to drive the AI engines +
 * Hypercore-backed History + Dictionary that live inside the worker.
 *
 * The worker shares the generated HRPC contract (`@opennib/core/hrpc`, compact-
 * encoding over bare-rpc) with the desktop core worker, so worker failures
 * surface here as the matching typed `OpennibError` subclass via `unwrap`.
 *
 * Singleton — there is exactly one worker per app process. Calling `start()`
 * twice is a no-op after the first promise resolves.
 */
class BareWorker {
  private worklet: Worklet | null = null
  private rpc: HRPC | null = null
  private starting: Promise<void> | null = null
  private progressHandlers = new Set<ModelProgressHandler>()

  async start(options: BareWorkerInitOptions): Promise<void> {
    if (this.rpc !== null) return
    if (this.starting !== null) return this.starting

    this.starting = (async () => {
      const worklet = new Worklet()
      // Decode to bytes before handing over: Worklet.start accepts a
      // TypedArray, and bytes survive the Metro → native bridge unchanged,
      // unlike a multi-megabyte non-ASCII source string.
      //
      // The args array mirrors the SDK's own worklet convention (see its
      // expo-rpc-client): under BareKit the SDK reads `Bare.argv[2]` as a
      // JSON env override, and HOME_DIR must point at a writable sandbox
      // dir or every registry model download fails with ENOTDIR.
      worklet.start("/app.bundle", base64Decode(workerBundleBase64), [
        "react-native-bare-kit",
        "worker.js",
        JSON.stringify({ HOME_DIR: options.sdkHomeDir }),
      ])
      // HRPC is symmetric — the worker pushes `modelProgress` events here,
      // dispatched to subscribers registered via `onModelProgress`.
      const rpc = new HRPC(worklet.IPC)
      rpc.onModelProgress((event) => {
        this.dispatchProgress(event)
      })
      this.worklet = worklet
      this.rpc = rpc
      try {
        unwrap(await rpc.init(options))
      } catch (cause) {
        this.starting = null
        this.rpc = null
        this.worklet = null
        worklet.terminate()
        throw new BareWorkerError("worker init failed", cause)
      }
      log.info("bare worker started", {
        historyDir: options.historyDir,
        dictionaryDir: options.dictionaryDir,
      })
    })()

    return this.starting
  }

  /**
   * Subscribe to model-download/load progress pushed from the worker. Returns
   * an unsubscribe function. Multiple subscribers are fine — each gets every
   * tick.
   */
  onModelProgress(handler: ModelProgressHandler): () => void {
    this.progressHandlers.add(handler)
    return () => {
      this.progressHandlers.delete(handler)
    }
  }

  // ── typed command surface (adapters call these, not a generic request) ──

  async historyList(options?: HistoryListOptions): Promise<readonly TranscriptEntry[]> {
    const res = unwrap(
      await this.client().historyList({
        limit: options?.limit ?? null,
        before: options?.before ?? null,
      }),
    )
    return res.entries ?? []
  }

  async historyAppend(entry: TranscriptEntry): Promise<void> {
    unwrap(await this.client().historyAppend({ entry }))
  }

  async historyClear(): Promise<void> {
    unwrap(await this.client().historyClear({}))
  }

  async dictionaryList(): Promise<readonly DictionaryEntry[]> {
    const res = unwrap(await this.client().dictionaryList({}))
    return res.entries ?? []
  }

  async dictionaryAdd(entry: DictionaryEntry): Promise<void> {
    unwrap(await this.client().dictionaryAdd(entry))
  }

  async dictionaryRemove(id: string): Promise<void> {
    unwrap(await this.client().dictionaryRemove({ id }))
  }

  async dictionaryClear(): Promise<void> {
    unwrap(await this.client().dictionaryClear({}))
  }

  async modelLoad(model: string, language: string): Promise<void> {
    unwrap(await this.client().modelLoad({ model, language }))
  }

  async transcribeFile(wavPath: string, model: string, language: string): Promise<string> {
    const res = unwrap<HrpcTextResponse>(
      await this.client().transcribeFile({ wavPath, model, language }),
    )
    return res.text ?? ""
  }

  /**
   * Run one dictation cycle in the worker-hosted pipeline on a recorded WAV:
   * speech gate → whisper → cleanup → history append. Resolves to the final
   * text, or null when the recording had no speech (nothing was appended).
   */
  async dictate(wavPath: string, model: string, language: string): Promise<string | null> {
    const res = unwrap<HrpcTextResponse>(await this.client().dictate({ wavPath, model, language }))
    return res.text
  }

  /** Configure the worker's LLM cleaner; `modelPath: null` turns cleanup off. */
  async cleanerConfigure(modelPath: string | null): Promise<void> {
    unwrap(await this.client().cleanerConfigure({ modelPath }))
  }

  async stop(): Promise<void> {
    if (this.worklet === null) return
    try {
      this.worklet.terminate()
    } finally {
      this.worklet = null
      this.rpc = null
      this.starting = null
    }
  }

  private client(): HRPC {
    if (this.rpc === null) throw new BareWorkerError("bare worker not started")
    return this.rpc
  }

  private dispatchProgress(event: HrpcModelProgress): void {
    for (const handler of this.progressHandlers) {
      try {
        handler(event)
      } catch (err) {
        log.error("model-progress handler threw", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}

export class BareWorkerError extends OpennibError {}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/**
 * Minimal base64 decoder — Hermes has no `Buffer` and no guaranteed `atob`.
 * Only handles the well-formed, padded output our bundler emits.
 */
function base64Decode(text: string): Uint8Array {
  const lookup = new Uint8Array(128)
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    lookup[BASE64_ALPHABET.charCodeAt(i)] = i
  }
  let length = text.length
  while (length > 0 && text[length - 1] === "=") length--
  const out = new Uint8Array(Math.floor((length * 3) / 4))
  let outIndex = 0
  for (let i = 0; i + 1 < length; i += 4) {
    const a = lookup[text.charCodeAt(i)] ?? 0
    const b = lookup[text.charCodeAt(i + 1)] ?? 0
    const c = i + 2 < length ? (lookup[text.charCodeAt(i + 2)] ?? 0) : 0
    const d = i + 3 < length ? (lookup[text.charCodeAt(i + 3)] ?? 0) : 0
    const triplet = (a << 18) | (b << 12) | (c << 6) | d
    if (outIndex < out.length) out[outIndex++] = (triplet >> 16) & 0xff
    if (i + 2 < length && outIndex < out.length) out[outIndex++] = (triplet >> 8) & 0xff
    if (i + 3 < length && outIndex < out.length) out[outIndex++] = triplet & 0xff
  }
  return out
}

export const bareWorker = new BareWorker()
