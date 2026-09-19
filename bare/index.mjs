// opennib mobile Bare worker. Hosts, INSIDE the Bare runtime that
// react-native-bare-kit embeds alongside Hermes:
//   - the AI engines (@qvac/sdk whisper + llama) running Bare-direct, and
//   - Hypercore-backed History + Dictionary (Hermes can't host Hypercore).
// Hermes drives this worker over the generated typed HRPC contract as a thin
// RPC client.
//
// This worker is independent of the @qvac/sdk's own internal Bare worker
// for AI on other paths — here the SDK is imported directly under Bare and
// selects Bare-direct mode, so models run in THIS process. That's why we
// register the whisper + llama plugins once before the first SDK call, the
// same way the desktop core worker does.
//
// The generated handler has NO try/catch: a throwing handler hangs the caller.
// Every handler is therefore wrapped in `guard`, which converts a thrown error
// into the response's `error {name, message}` envelope (rehydrated client-side
// into the matching OpennibError subclass).
import fs from "bare-fs"

import HRPC from "@opennib/core/hrpc"
import { HypercoreHistory, HypercoreDictionary } from "@opennib/core/hypercore"
import {
  DictationPipeline,
  buildWhisperModelConfig,
  cleanupText,
  decodeWav,
  log,
  ModelLoadError,
} from "@opennib/core"

// Filesystem slice the Hypercore stores need for compaction (rename / remove /
// exists). Injected rather than imported by core so core stays runtime-neutral.
const storageFs = {
  rename: (from, to) => fs.promises.rename(from, to),
  remove: (path) => fs.promises.rm(path, { recursive: true, force: true }),
  exists: async (path) => {
    try {
      await fs.promises.stat(path)
      return true
    } catch {
      return false
    }
  },
}

const { IPC } = BareKit

// State constructed by INIT. Every non-INIT storage handler checks these are
// set and fails with a typed error otherwise, so a misordered client gets a
// clean error reply instead of crashing the worklet.
let history = null
let dictionary = null
let pluginsRegistered = false

// A single loaded whisper model, cached by its `(model, language)` key —
// whisper.cpp bakes `language` in at load time, so a language switch (or a
// model switch) has to unload and reload. Mirrors the old Hermes hook's
// unload-on-change lifecycle, now that the model lives here.
let whisperModelId = null
let whisperKey = null

// The active LLM cleaner (LlmCleaner) or null when cleanup is off.
let cleaner = null

// ── worker-hosted DictationPipeline ──────────────────────────────────────
// The same orchestrator the desktop app runs (speech gate → transcribe →
// cleanup → paste → history), hosted here so both platforms share one code
// path. The host records to a WAV file and calls `dictate`; these adapters
// bridge that file-based flow onto the pipeline's interfaces. `cycle` holds
// the per-call state: input path + settings in, transcript or error out.
const cycle = { wavPath: null, model: "tiny", language: "auto", text: null, error: null }

const recorder = {
  async start() {},
  async stop() {
    if (cycle.wavPath === null) throw new Error("dictate: no recording to stop")
    const bytes = await fs.promises.readFile(cycle.wavPath)
    return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  },
}

const transcriber = {
  // The pipeline hands us the decoded frame (it already ran the speech gate
  // on it); the SDK wants a file it can ffmpeg-decode, so we pass the WAV the
  // host recorded instead of re-encoding the frame.
  async transcribe(_frame, modelId, language) {
    const id = await ensureWhisperLoaded(modelId, language, (p) => pushModelProgress(modelId, p))
    const { transcribe } = await import("@qvac/sdk")
    const result = await transcribe({ modelId: id, audioChunk: cycle.wavPath })
    return typeof result === "string" ? result : (result?.text ?? "")
  },
}

// Models come from the SDK registry on demand, so "installed" is always true
// and the "path" is the catalog id ensureWhisperLoaded maps to a registry constant.
const modelManager = {
  isInstalled: async () => true,
  pathFor: async (id) => id,
  download: async (id, onProgress) => {
    await ensureWhisperLoaded(id, cycle.language, onProgress)
  },
  remove: async () => {},
}

// The host owns settings (AsyncStorage) and passes the relevant values with
// each dictate call, so this view is read-only: setters are no-ops and
// onChange never fires.
const pipelineSettings = {
  whisperModelId: () => cycle.model,
  language: () => cycle.language,
  cleanupEnabled: () => cleaner !== null,
  llmModelId: () => null,
  setWhisperModelId: async () => {},
  setLanguage: async () => {},
  setCleanupEnabled: async () => {},
  setLlmModelId: async () => {},
  onChange: () => () => {},
  snapshot: () => ({
    whisperModelId: cycle.model,
    language: cycle.language,
    cleanupEnabled: cleaner !== null,
    llmModelId: null,
  }),
}

const paster = {
  async paste(text) {
    cycle.text = text
  },
}

// The pipeline reports failures through the notifier rather than throwing;
// capture them so the dictate reply carries a typed error envelope.
const notifier = {
  async notify(title, body) {
    cycle.error = { name: "DictationError", message: `${title}: ${body}` }
  },
}

let pipeline = null

/**
 * Wrap an HRPC handler so a thrown error becomes the response's `error`
 * envelope instead of hanging the caller (the generated handler has no
 * try/catch). `nullFields` are the non-`error` fields of the response struct,
 * defaulted so the compact-encoding encode step still has every field present.
 */
function guard(fn, nullFields = {}) {
  return async (req) => {
    try {
      return await fn(req)
    } catch (err) {
      return {
        error: { name: err?.name ?? "OpennibError", message: err?.message ?? String(err) },
        ...nullFields,
      }
    }
  }
}

/**
 * Register the whisper SDK plugin exactly once. Bare-direct mode requires
 * plugins to be registered before the first loadModel call, and
 * re-registering is wasteful, so we gate on a flag.
 *
 * WHISPER ONLY on mobile: importing `@qvac/sdk/llamacpp-completion/plugin`
 * loads the `@qvac/llm-llamacpp` native addon at import time, and that
 * framework is NOT linked into the app binary (ADDON_NOT_FOUND on device —
 * the SDK's config plugin links only what the app uses). Mobile LLM cleanup
 * is upstream-blocked anyway (see onCleanerConfigure); when it unblocks,
 * register the llm plugin lazily THERE, and link its framework via the SDK
 * config plugin in the same change.
 */
async function ensurePlugins() {
  if (pluginsRegistered) return
  const { plugins } = await import("@qvac/sdk")
  const { whisperPlugin } = await import("@qvac/sdk/whispercpp-transcription/plugin")
  plugins([whisperPlugin])
  pluginsRegistered = true
}

function requireInit() {
  if (history === null || dictionary === null) {
    throw new Error("bare worker command received before INIT")
  }
}

/**
 * Map opennib's core whisper catalog id onto the SDK registry constant we
 * hand to `loadModel`. Mobile exposes tiny / base / small / large-v3-turbo;
 * anything else falls back to the bundled tiny model so an unrecognized
 * stored value never wedges the app. (Moved verbatim from the old Hermes
 * `sdkModelFor` in use-transcriber.ts.)
 */
async function sdkModelFor(id) {
  const { WHISPER_TINY, WHISPER_BASE_Q8_0, WHISPER_SMALL_Q8_0, WHISPER_LARGE_V3_TURBO } =
    await import("@qvac/sdk")
  switch (id) {
    case "base":
      return WHISPER_BASE_Q8_0
    case "small":
      return WHISPER_SMALL_Q8_0
    case "large-v3-turbo":
      return WHISPER_LARGE_V3_TURBO
    case "tiny":
    default:
      return WHISPER_TINY
  }
}

/**
 * Ensure a whisper model matching `(model, language)` is loaded, reloading
 * (and unloading the previous one) when the key changes. `onProgress`, when
 * given, receives 0–100 percentages during a download/load.
 */
async function ensureWhisperLoaded(model, language, onProgress) {
  const key = `${model} ${language}`
  if (whisperModelId !== null && whisperKey === key) return whisperModelId

  await ensurePlugins()
  const { loadModel, unloadModel } = await import("@qvac/sdk")

  if (whisperModelId !== null) {
    const previous = whisperModelId
    whisperModelId = null
    whisperKey = null
    // Best-effort: a failed unload of the old model must not block loading
    // the new one. Swallowed deliberately — the reload below is what matters.
    await unloadModel({ modelId: previous }).catch(() => {})
  }

  const modelSrc = await sdkModelFor(model)
  // The whisper config invariants (omit `detect_language`; `audio_format` is
  // "f32le" because the SDK ffmpeg-decodes our WAV before whisper sees it)
  // live in core's `buildWhisperModelConfig`, shared with desktop so the two
  // load sites can't drift. GPU + flash-attn stay off on mobile — mid-range
  // devices are more stable on the CPU path.
  const id = await loadModel({
    modelSrc,
    modelType: "whisper",
    modelConfig: buildWhisperModelConfig({
      language,
      audioFormat: "f32le",
      useGpu: false,
      flashAttn: false,
    }),
    onProgress:
      onProgress === undefined
        ? undefined
        : (update) => {
            if (typeof update?.percentage === "number") onProgress(update.percentage)
          },
  })
  whisperModelId = id
  whisperKey = key
  return id
}

async function unloadWhisper() {
  if (whisperModelId === null) return
  const id = whisperModelId
  whisperModelId = null
  whisperKey = null
  const { unloadModel } = await import("@qvac/sdk")
  await unloadModel({ modelId: id })
}

const rpc = new HRPC(IPC)

/**
 * Push a `modelProgress` event to the host, fire-and-forget. Older host builds
 * may not register the handler; the send is advisory, so we swallow any failure
 * with a comment rather than let a progress tick crash a load.
 */
function pushModelProgress(model, percent) {
  try {
    rpc.modelProgress({ model, percent })
  } catch {
    // No host handler (old build) or the channel is tearing down — progress is
    // advisory, so dropping a tick is fine.
  }
}

rpc.onInit(
  guard(async (req) => {
    const { historyDir, dictionaryDir } = req
    if (typeof historyDir !== "string" || typeof dictionaryDir !== "string") {
      throw new Error("INIT payload missing historyDir/dictionaryDir")
    }
    history = new HypercoreHistory({ storagePath: historyDir, fs: storageFs })
    dictionary = new HypercoreDictionary({ storagePath: dictionaryDir, fs: storageFs })
    pipeline = new DictationPipeline({
      recorder,
      transcriber,
      modelManager,
      cleaner: () => cleaner,
      dictionary,
      paster,
      history,
      notifier,
      settings: pipelineSettings,
      idFactory: () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    return { error: null }
  }),
)

rpc.onModelLoad(
  guard(async (req) => {
    const { model, language } = req
    await ensureWhisperLoaded(model, language, (percent) => pushModelProgress(model, percent))
    return { error: null }
  }),
)

rpc.onTranscribeFile(
  guard(
    async (req) => {
      const { wavPath, model, language } = req
      const modelId = await ensureWhisperLoaded(model, language)
      const { transcribe } = await import("@qvac/sdk")
      const result = await transcribe({ modelId, audioChunk: wavPath })
      const raw = typeof result === "string" ? result : (result?.text ?? "")

      if (cleaner === null) return { error: null, text: raw }

      // Best-effort cleanup, mirroring DictationPipeline's semantics: fetch the
      // custom dictionary, run core's orchestrator, and fall back to the raw
      // transcript if the LLM pass fails. Cleanup is cosmetics, never a hard
      // dependency on producing a transcript.
      const trimmed = raw.trim()
      if (trimmed.length === 0) return { error: null, text: raw }
      try {
        const terms = dictionary === null ? undefined : await dictionary.list()
        const cleaned = await cleanupText(raw, { cleaner, language, terms })
        return { error: null, text: cleaned }
      } catch (err) {
        log.warn("cleanup failed; returning raw transcript", {
          error: err instanceof Error ? err.message : String(err),
        })
        return { error: null, text: raw }
      }
    },
    { text: null },
  ),
)

rpc.onDictate(
  guard(
    async (req) => {
      requireInit()
      cycle.wavPath = req.wavPath
      cycle.model = req.model
      cycle.language = req.language
      cycle.text = null
      cycle.error = null
      // beginCycle is a no-op recorder.start here; endCycle runs the whole
      // chain and returns when history has been appended (or the cycle was
      // dropped by the speech gate, in which case text stays null).
      await pipeline.beginCycle()
      await pipeline.endCycle()
      if (cycle.error !== null) return { error: cycle.error, text: null }
      return { error: null, text: cycle.text }
    },
    { text: null },
  ),
)

rpc.onTranscriberUnloadAll(
  guard(async () => {
    await unloadWhisper()
    return { error: null }
  }),
)

rpc.onCleanerConfigure(
  guard(async (req) => {
    const { modelPath } = req
    if (modelPath === null) {
      await cleaner?.unload()
      cleaner = null
      return { error: null }
    }
    // Mobile carries a core LLM catalog id here (e.g. "qwen2.5-0.5b-instruct-q4").
    // The @qvac/sdk registry ships no Qwen2.5 instruct constant — only the
    // Qwen3 family — so there is no on-device weight the SDK can download for
    // these ids. Rather than fake it, we surface a typed error naming the
    // limitation and leave the rest of the plumbing intact for when a matching
    // constant (or a modelPath-based mobile download) lands.
    throw new ModelLoadError(
      `LLM cleanup is unavailable on mobile: the @qvac/sdk registry has no ` +
        `constant for "${modelPath}" (only the Qwen3 family is published).`,
    )
  }),
)

rpc.onHistoryList(
  guard(
    async (req) => {
      requireInit()
      // `limit` 0/null means "no limit"; `before` null means "from newest".
      const options = {}
      if (req.limit) options.limit = req.limit
      if (req.before) options.before = req.before
      const entries = await history.list(options)
      return { error: null, entries }
    },
    { entries: null },
  ),
)

rpc.onHistoryAppend(
  guard(async (req) => {
    requireInit()
    await history.append(req.entry)
    return { error: null }
  }),
)

rpc.onHistoryClear(
  guard(async () => {
    requireInit()
    await history.clear()
    return { error: null }
  }),
)

rpc.onDictionaryList(
  guard(
    async () => {
      requireInit()
      const entries = await dictionary.list()
      return { error: null, entries }
    },
    { entries: null },
  ),
)

rpc.onDictionaryAdd(
  guard(async (req) => {
    requireInit()
    await dictionary.add(req)
    return { error: null }
  }),
)

rpc.onDictionaryRemove(
  guard(async (req) => {
    requireInit()
    await dictionary.remove(req.id)
    return { error: null }
  }),
)

rpc.onDictionaryClear(
  guard(async () => {
    requireInit()
    await dictionary.clear()
    return { error: null }
  }),
)

rpc.onShutdown(
  guard(async () => {
    // Best-effort teardown of everything the worker owns. Release corestore
    // fd-locks first, then unload the native engines.
    if (history !== null) await history.close()
    if (dictionary !== null) await dictionary.close()
    await unloadWhisper()
    if (cleaner !== null) await cleaner.unload()
    history = null
    dictionary = null
    cleaner = null
    pipeline = null
    return { error: null }
  }),
)
