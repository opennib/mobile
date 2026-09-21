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
  encodeWavPcm16,
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

// Under react-native-bare-kit, Bare's stdout/stderr are forwarded to the
// platform log (logcat tag "BareKit" on Android). console.* inside the
// worklet is NOT, so core's `log` and the SDK's server logger vanished on
// device. Route console to stderr so worker + SDK diagnostics are visible.
{
  const write =
    (level) =>
    (...args) => {
      try {
        const line = args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 0)))
          .join(" ")
        Bare.stderr?.write?.(`[worker:${level}] ${line}\n`)
      } catch {
        // Logging must never throw inside a handler.
      }
    }
  console.log = write("info")
  console.info = write("info")
  console.warn = write("warn")
  console.error = write("error")
  console.debug = write("debug")
}

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

const RIFF_MAGIC = "RIFF"

/**
 * Decode whatever the host recorded into a 16 kHz mono float frame. iOS
 * (expo-av LINEARPCM) and the Android IME (AudioRecord) write real WAVs, which
 * core's parser handles. expo-av on Android ignores the ".wav" extension and
 * writes a 3GP/AAC container, so anything that isn't RIFF goes through the
 * SDK's ffmpeg decoder — the same addon whisper itself uses on that path.
 */
async function decodeRecording(path) {
  const bytes = await fs.promises.readFile(path)
  if (bytes.length >= 4 && bytes.toString("latin1", 0, 4) === RIFF_MAGIC) {
    return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  }
  const { FFmpegDecoder } = await import("@qvac/decoder-audio")
  const decoder = new FFmpegDecoder({ config: { audioFormat: "f32le" } })
  await decoder.load()
  // The decoder drops the first 300 ms of every AAC stream to hide encoder
  // priming. That's right for downloaded music and wrong for a push-to-talk
  // capture, where the user may already be speaking at t=0 (it clipped
  // "Testing 1 2 3" to "the packaged worker is alive" in tests). Keep every
  // sample; the priming a recorder emits is a few ms of silence at most.
  decoder.totalSkipSamples = 0
  Object.defineProperty(decoder, "totalSkipSamples", {
    get: () => 0,
    set: () => {},
    configurable: true,
  })
  try {
    const chunks = []
    await new Promise((resolve, reject) => {
      decoder
        .run(fs.createReadStream(path))
        .onUpdate((out) => chunks.push(Buffer.from(new Uint8Array(out.outputArray))))
        .onFinish(resolve)
        .onError(reject)
    })
    const pcm = Buffer.concat(chunks)
    // ffmpeg emits at the decoder's default: 16 kHz mono f32le for this SDK
    // build (what whisper consumes). Copy so the Float32Array is aligned.
    const aligned = new Uint8Array(pcm.length)
    aligned.set(pcm)
    const samples = new Float32Array(aligned.buffer, 0, Math.floor(pcm.length / 4))
    return { samples, sampleRate: 16000, durationMs: Math.round((samples.length / 16000) * 1000) }
  } finally {
    await decoder.unload()
  }
}

const recorder = {
  async start() {},
  async stop() {
    if (cycle.wavPath === null) throw new Error("dictate: no recording to stop")
    return decodeRecording(cycle.wavPath)
  },
}

const transcriber = {
  // Transcribe the frame the pipeline gated, not the host's file: the SDK
  // would re-decode a 3GP itself and drop its first 300 ms (see
  // decodeRecording). Whisper gets a plain PCM16 WAV written next to the
  // recording, so the gate and the model see identical audio.
  async transcribe(frame, modelId, language) {
    const id = await ensureWhisperLoaded(modelId, language, (p) => pushModelProgress(modelId, p))
    const { transcribe } = await import("@qvac/sdk")
    const pcmPath = `${cycle.wavPath}.pcm16.wav`
    await fs.promises.writeFile(pcmPath, encodeWavPcm16(frame))
    try {
      const result = await transcribe({ modelId: id, audioChunk: pcmPath })
      return typeof result === "string" ? result : (result?.text ?? "")
    } finally {
      // Scratch file; a failed cleanup must not fail the transcription.
      await fs.promises.rm(pcmPath, { force: true }).catch(() => {})
    }
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
 * Loading a registry constant makes the SDK re-verify the cached file's
 * SHA-256 on EVERY load — a 77 MB stream hash in JavaScript, which takes
 * minutes on a mid-range phone (and ran silently on every app reload: the
 * "tap does nothing for five minutes" report). `getModelInfo` only stats the
 * cache and returns the file's absolute path, and `loadModel` with a plain
 * path skips download and checksum entirely. The hash is still verified once,
 * on the initial download. First-run downloads keep going through the
 * registry constant so progress events still flow.
 */
async function resolveModelSrc(registrySrc) {
  const { getModelInfo } = await import("@qvac/sdk")
  const t0 = Date.now()
  const info = await getModelInfo(registrySrc)
  const path = info?.isCached
    ? (info.primaryPath ?? info.path ?? info.cacheFiles?.[0]?.path)
    : undefined
  log.info("whisper model source resolved", {
    cached: Boolean(path),
    ms: Date.now() - t0,
  })
  return typeof path === "string" && path.length > 0 ? path : registrySrc
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

  const modelSrc = await resolveModelSrc(await sdkModelFor(model))
  // The whisper config invariants (omit `detect_language`; `audio_format` is
  // "f32le" because the SDK ffmpeg-decodes our WAV before whisper sees it)
  // live in core's `buildWhisperModelConfig`, shared with desktop so the two
  // load sites can't drift. GPU + flash-attn stay off on mobile — mid-range
  // devices are more stable on the CPU path.
  const t0 = Date.now()
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
  log.info("whisper model loaded", { model, language, ms: Date.now() - t0 })
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
