import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { StatusBar } from "expo-status-bar"
import * as Clipboard from "expo-clipboard"
import Svg, { Circle, Path } from "react-native-svg"
import { SUPPORTED_LANGUAGES } from "@opennib/core"

import { useRecorder } from "../hooks/use-recorder"
import { useTranscriber } from "../hooks/use-transcriber"
import { usePermissions } from "../hooks/use-permissions"
import { useKeyboardStatus } from "../hooks/use-keyboard-status"
import { addSharedGroupListener, getSharedGroup } from "../native/shared-group"
import {
  addKeyboardEventListener,
  addKeyboardReadyListener,
  type KeyboardReadyEvent,
  resolveKeyboardTranscript,
} from "../native/keyboard-bridge"
import { useSettings } from "../hooks/use-settings"
import { useHistory } from "../hooks/use-history"

import { tokens, monoFontFamily } from "../theme/tokens"
import { Lockup } from "../components/Brand"
import { MicButton } from "../components/MicButton"
import { LiveWave, WaveformFrozen } from "../components/Waveform"
import { TranscriptCard } from "../components/TranscriptCard"
import { NoticeCard } from "../components/NoticeCard"

const KEYBOARD_SETTINGS_URL = "App-Prefs:General&path=Keyboard/KEYBOARDS"
const HEARTBEAT_INTERVAL_MS = 3000
/** Transient banners (errors, no-speech warning) auto-dismiss after this.
 *  Setup banners (mic permission, keyboard install) stay — they're actionable
 *  states, not notifications. */
const TRANSIENT_BANNER_MS = 6000

type RemoteSource = "keyboard" | "deeplink" | null

export interface HomeScreenProps {
  readonly onOpenSettings: () => void
  readonly onOpenHistory?: () => void
  readonly onOpenDictionary?: () => void
}

export function HomeScreen({ onOpenSettings, onOpenHistory, onOpenDictionary }: HomeScreenProps) {
  const settings = useSettings()
  const history = useHistory()
  const transcriberOpts = useMemo(
    () => ({
      whisperModelId: settings.ready ? settings.snapshot.whisperModelId : "tiny",
      language: settings.ready ? settings.snapshot.language : "auto",
    }),
    [settings],
  )
  const recorder = useRecorder()
  const transcriber = useTranscriber(transcriberOpts)
  const permissions = usePermissions()
  const keyboard = useKeyboardStatus()
  const recentEntries = history.ready ? history.entries.slice(0, 20) : []
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [remoteSource, setRemoteSource] = useState<RemoteSource>(null)
  // Set briefly when a recording finished but whisper returned an empty
  // transcript (silence / noise / iOS simulator mic returning junk). Without
  // this the cycle completes silently and the user can't tell whether the
  // recorder even worked.
  const [lastEmpty, setLastEmpty] = useState(false)
  // Elapsed seconds during the active recording — drives the M-A-2 sub-label
  // (`0:03 · HOLD TO KEEP RECORDING`). Resets on stop.
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0)

  // Transient-banner auto-dismiss. `recorder.error`/`transcriber.error` live
  // inside their hooks, so instead of clearing them we remember the last
  // dismissed message and hide the banner while it's unchanged; a NEW error
  // (different text) re-shows it.
  const errBody = recorder.error ?? transcriber.error ?? pasteError
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  useEffect(() => {
    if (errBody === null) return
    setDismissedError(null)
    const id = setTimeout(() => setDismissedError(errBody), TRANSIENT_BANNER_MS)
    return () => clearTimeout(id)
  }, [errBody])
  useEffect(() => {
    if (!lastEmpty) return
    const id = setTimeout(() => setLastEmpty(false), TRANSIENT_BANNER_MS)
    return () => clearTimeout(id)
  }, [lastEmpty])

  useEffect(() => {
    if (!recorder.isRecording) {
      setRecordingElapsedSec(0)
      return
    }
    const startedAt = Date.now()
    setRecordingElapsedSec(0)
    const id = setInterval(() => {
      setRecordingElapsedSec(Math.floor((Date.now() - startedAt) / 1000))
    }, 250)
    return () => clearInterval(id)
  }, [recorder.isRecording])

  // Re-check OS-level state when the user comes back from Settings.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void permissions.refresh()
        void keyboard.refresh()
      }
    })
    return () => sub.remove()
  }, [permissions, keyboard])

  const recorderRef = useRef(recorder)
  recorderRef.current = recorder
  const transcriberRef = useRef(transcriber)
  transcriberRef.current = transcriber
  const historyRef = useRef(history)
  historyRef.current = history
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const busyRef = useRef(false)
  const inflightRemoteRef = useRef(false)
  const recordingStartedAtRef = useRef<number | null>(null)

  /**
   * Run the full record→transcribe→writeTranscript pipeline. `pipeWithKeyboard`
   * controls whether the resulting transcript is mirrored back to the App Group
   * so the keyboard extension can insert it into the host text app.
   *
   * When `pipeWithKeyboard` is true we ALWAYS signal the keyboard at the end —
   * even if recording captured nothing or transcription was empty — so the
   * keyboard exits its "Transcribing…" state instead of hanging forever.
   */
  const stopAndTranscribe = useCallback(async (pipeWithKeyboard: boolean): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    recordingStartedAtRef.current = null
    let trimmed = ""
    try {
      const wavPath = await recorderRef.current.stop()
      if (wavPath !== null) {
        const text = await transcriberRef.current.transcribe(wavPath)
        trimmed = text.trim()
      }
    } catch (e) {
      setPasteError(errorMessage(e))
    } finally {
      busyRef.current = false
      setRemoteSource(null)
      inflightRemoteRef.current = false
    }

    if (trimmed.length > 0) {
      setLastEmpty(false)
      // The worker's pipeline already appended this entry; refresh the view.
      const h = historyRef.current
      if (h.ready) {
        try {
          await h.reload()
        } catch (e) {
          setPasteError(errorMessage(e))
        }
      }
    } else {
      // Empty transcript — surface a notice so the user knows the cycle ran.
      // Especially common in the iOS simulator (mic returns noise/silence)
      // and helps separate "whisper heard nothing" from "the app froze."
      setLastEmpty(true)
    }

    if (pipeWithKeyboard) {
      const sharedGroup = getSharedGroup()
      if (sharedGroup !== null) {
        try {
          await sharedGroup.writeTranscript(trimmed)
        } catch (e) {
          setPasteError(errorMessage(e))
        }
      }
      // Android: deliver text back to the IME so it can commitText + reset
      // the keyboard's status label. No-op on iOS.
      resolveKeyboardTranscript(trimmed)
    } else if (trimmed.length > 0) {
      try {
        await Clipboard.setStringAsync(trimmed)
      } catch (e) {
        setPasteError(errorMessage(e))
      }
    }
  }, [])

  /**
   * Android-only: the IME captured audio natively and handed us a WAV path.
   * Skip the JS recorder entirely (it never ran), transcribe the file,
   * append to history, and ship the text back to the IME so it can
   * `commitText` into the host app and reset its "Transcribing…" label.
   * Always calls `resolveKeyboardTranscript` even on empty/error so the
   * IME never wedges.
   */
  const transcribeAndDeliverAndroid = useCallback(async (wavPath: string): Promise<void> => {
    if (busyRef.current) {
      console.warn("[kbd-android] onReady dropped — busy")
      resolveKeyboardTranscript("")
      return
    }
    busyRef.current = true
    recordingStartedAtRef.current = null
    let trimmed = ""
    try {
      const text = await transcriberRef.current.transcribe(wavPath)
      trimmed = text.trim()
    } catch (e) {
      setPasteError(errorMessage(e))
    } finally {
      busyRef.current = false
      setRemoteSource(null)
      inflightRemoteRef.current = false
    }

    if (trimmed.length > 0) {
      // The worker's pipeline already appended this entry; refresh the view.
      const h = historyRef.current
      if (h.ready) {
        try {
          await h.reload()
        } catch (e) {
          setPasteError(errorMessage(e))
        }
      }
    }

    resolveKeyboardTranscript(trimmed)
  }, [])

  // 0) Live mic level for the keyboard's waveform. Only while the keyboard
  // drives the recording — the keyboard is sandboxed and cannot hear the mic,
  // so the host is the only source. A final 0 on stop lets the wave settle.
  useEffect(() => {
    const sharedGroup = getSharedGroup()
    if (sharedGroup === null) return
    if (remoteSource !== "keyboard") return
    sharedGroup.writeAudioLevel(recorder.isRecording ? recorder.level : 0)
  }, [remoteSource, recorder.isRecording, recorder.level])

  // 1) Liveness heartbeat — keyboard reads this to decide hot vs. cold path.
  useEffect(() => {
    const sharedGroup = getSharedGroup()
    if (sharedGroup === null) return
    const tick = (): void => {
      sharedGroup.heartbeat().catch(() => {})
    }
    tick()
    const id = setInterval(tick, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // 2) Remote start/stop signals from the keyboard.
  useEffect(() => {
    const onStart = (): void => {
      const tStatus = transcriberRef.current.status
      console.info("[kbd] onStart", {
        tStatus,
        rRec: recorderRef.current.isRecording,
        busy: busyRef.current,
        inflight: inflightRemoteRef.current,
      })
      if (tStatus !== "ready") {
        resolveKeyboardTranscript("")
        return
      }
      // The IME's recordStart is authoritative — a fresh hold means the user
      // wants to start a new dictation. If anything from a prior cycle is
      // still flagged (recorder wedged, busy mid-transcribe, leftover remote
      // session), drop it on the floor and start clean. Without this, a
      // single failed cycle in a third-party app permanently jams the
      // pipeline and every subsequent hold short-circuits with empty text.
      void (async () => {
        if (recorderRef.current.isRecording || busyRef.current || inflightRemoteRef.current) {
          console.warn("[kbd] onStart resetting stale state")
          try {
            await recorderRef.current.stop()
          } catch (e) {
            console.warn("[kbd] stale recorder.stop failed", e)
          }
          busyRef.current = false
          inflightRemoteRef.current = false
          recordingStartedAtRef.current = null
          setRemoteSource(null)
        }
        inflightRemoteRef.current = true
        setRemoteSource("keyboard")
        recordingStartedAtRef.current = Date.now()
        try {
          await recorderRef.current.start()
        } catch (e) {
          console.warn("[kbd] recorder.start failed", e)
          inflightRemoteRef.current = false
          setRemoteSource(null)
          recordingStartedAtRef.current = null
          getSharedGroup()
            ?.writeTranscript("")
            .catch(() => {})
          resolveKeyboardTranscript("")
        }
      })()
    }
    const onStop = (): void => {
      console.info("[kbd] onStop", {
        inflight: inflightRemoteRef.current,
        rRec: recorderRef.current.isRecording,
        busy: busyRef.current,
      })
      if (!inflightRemoteRef.current && !recorderRef.current.isRecording) {
        resolveKeyboardTranscript("")
        return
      }
      void stopAndTranscribe(true)
    }
    // iOS: Darwin notifications via the App Group bridge. The keyboard
    // extension uses JS-side audio capture (AVAudioEngine in opennib lives
    // in JS); recordStart kicks the recorder, recordStop drains it.
    const iosStartSub = addSharedGroupListener("recordStart", onStart)
    const iosStopSub = addSharedGroupListener("recordStop", onStop)

    // Android: the IME captures audio natively in Kotlin. recordStart is a
    // UI-only signal (don't touch the recorder); recordReady arrives with a
    // WAV path that we transcribe and ship back via resolveKeyboardTranscript.
    const onAndroidStart = (): void => {
      const tStatus = transcriberRef.current.status
      console.info("[kbd-android] onStart", { tStatus, busy: busyRef.current })
      if (tStatus !== "ready") {
        resolveKeyboardTranscript("")
        return
      }
      inflightRemoteRef.current = true
      setRemoteSource("keyboard")
      recordingStartedAtRef.current = Date.now()
    }
    const onAndroidReady = ({ wavPath }: KeyboardReadyEvent): void => {
      console.info("[kbd-android] onReady", { wavPath })
      void transcribeAndDeliverAndroid(wavPath)
    }
    const andStartSub = addKeyboardEventListener("opennib:recordStart", onAndroidStart)
    const andReadySub = addKeyboardReadyListener(onAndroidReady)
    return () => {
      iosStartSub.remove()
      iosStopSub.remove()
      andStartSub.remove()
      andReadySub.remove()
    }
  }, [stopAndTranscribe, transcribeAndDeliverAndroid])

  // 3) Cold-start bootstrap: keyboard couldn't reach us so it opened our URL.
  //    Surface a banner so the user knows to record here.
  useEffect(() => {
    function handleUrl(url: string | null): void {
      if (url === null) return
      if (url.startsWith("opennib://record")) {
        setRemoteSource((prev) => prev ?? "deeplink")
      }
    }
    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => {})
    const sub = Linking.addEventListener("url", (event) => handleUrl(event.url))
    return () => sub.remove()
  }, [])

  async function onPressIn(): Promise<void> {
    // Strictly "ready", not the looser `ready` flag: that one includes
    // "transcribing", where the MicButton is hidden but still mounted — a tap
    // there would start a second recording mid-pipeline. Also refuse while a
    // recording is already active (double press-in).
    if (transcriber.status !== "ready" || recorder.isRecording) return
    setPasteError(null)
    setLastEmpty(false)
    recordingStartedAtRef.current = Date.now()
    try {
      await recorder.start()
    } catch {
      recordingStartedAtRef.current = null
      // useRecorder already pushed the error into state.
    }
  }

  async function onPressOut(): Promise<void> {
    if (!recorder.isRecording) return
    // Local press-to-record: pipe to keyboard only if we got here via deep link.
    await stopAndTranscribe(remoteSource === "deeplink")
  }

  const remoteBanner = bannerFor(remoteSource)
  const setupBanner = setupBannerFor(permissions.microphone, keyboard.everActivated)
  const languageLabel = settings.ready ? describeLanguage(settings.snapshot.language) : "English"

  // Mic panel state mirrors the pipeline:
  //   idle → resting hairline + MicButton ready to press
  //   recording → live wave + MicButton in stop-square state (hold-to-talk)
  //   transcribing → frozen dim wave + ActivityIndicator + "Transcribing…"
  //   loading → centered ActivityIndicator + "Loading model…"
  //   error → centered "Model failed to load" + ink-2 text
  const micPhase: "idle" | "recording" | "transcribing" | "loading" | "error" =
    transcriber.status === "loading"
      ? "loading"
      : transcriber.status === "error"
        ? "error"
        : recorder.isRecording
          ? "recording"
          : transcriber.status === "transcribing"
            ? "transcribing"
            : "idle"

  const micButtonState =
    setupBanner === "mic-denied" || setupBanner === "mic-undetermined"
      ? "disabled"
      : micPhase === "recording"
        ? "recording"
        : "idle"

  // M-A-5: only a hard denial gets the red slash + "Microphone unavailable"
  // labels. Undetermined (never asked) keeps the plain disabled button while
  // the banner invites the user to grant access.
  const micBlocked = setupBanner === "mic-denied"

  const lockedFromKeyboard = remoteSource === "keyboard"

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />

      {/* ─── Header: lockup + nav pills ─────────────────────────── */}
      <View style={styles.header}>
        <Lockup size={18} />
        <View style={styles.pillRow}>
          {onOpenHistory !== undefined && (
            <Pressable
              onPress={onOpenHistory}
              style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
            >
              <Text style={styles.pillText}>History</Text>
            </Pressable>
          )}
          {onOpenDictionary !== undefined && (
            <Pressable
              onPress={onOpenDictionary}
              style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
            >
              <Text style={styles.pillText}>Dictionary</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onOpenSettings}
            hitSlop={8}
            style={({ pressed }) => [styles.gearButton, pressed && styles.pillPressed]}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Circle cx={12} cy={12} r={3.2} stroke={tokens.ink2} strokeWidth={1.5} />
              <Path
                d="M19.1 12c0-.5 0-.9-.1-1.4l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.4-1.4L13.9 2h-3.8l-.4 2.3A7 7 0 0 0 7.3 5.7l-2.3-1-2 3.4 2 1.5c-.1.5-.1.9-.1 1.4s0 .9.1 1.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.4 1.4l.4 2.3h3.8l.4-2.3a7 7 0 0 0 2.4-1.4l2.3 1 2-3.4-2-1.5c.1-.5.1-.9.1-1.4z"
                stroke={tokens.ink2}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        </View>
      </View>

      {/* ─── Banners (setup gating + remote-source nudges) ─────── */}
      {setupBanner !== null && (
        <View style={styles.bannerWrap}>
          <NoticeCard
            tone={setupBanner === "mic-denied" ? "error" : "warn"}
            title={setupBannerCopy(setupBanner).title}
            body={setupBannerCopy(setupBanner).body}
            actionLabel={setupBannerCopy(setupBanner).action}
            onAction={() => {
              void runSetupBannerAction(setupBanner)
            }}
          />
        </View>
      )}
      {remoteBanner !== null && (
        <View style={styles.bannerWrap}>
          <NoticeCard tone="warn" title={remoteBanner} />
        </View>
      )}
      {errBody !== null && errBody !== dismissedError && (
        <View style={styles.bannerWrap}>
          <NoticeCard tone="error" title="Something went wrong" body={errBody} />
        </View>
      )}
      {lastEmpty && (
        <View style={styles.bannerWrap}>
          <NoticeCard
            tone="warn"
            title="No speech detected"
            body="The mic picked up silence or noise. On the iOS simulator this is normal — test on a real device for real input."
          />
        </View>
      )}

      {/* ─── Transcript history (recent) ────────────────────────── */}
      <ScrollView style={styles.transcripts} contentContainerStyle={styles.transcriptsContent}>
        {/* Skeleton placeholder slides in at the top of the list while
            transcription is in flight — matches design M-A-3. The real
            entry replaces it on completion. */}
        {micPhase === "transcribing" && (
          <View style={styles.cardSpacing}>
            <SkeletonCard />
          </View>
        )}
        {recentEntries.length === 0 && micPhase !== "transcribing" ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>No transcripts yet</Text>
            <Text style={styles.placeholderBody}>
              Hold the mic below to start your first dictation.
            </Text>
          </View>
        ) : (
          recentEntries.map((entry) => (
            <View key={entry.id} style={styles.cardSpacing}>
              <TranscriptCard
                time={describeWhen(entry.createdAt)}
                text={entry.text}
                length={formatDuration(entry.durationMs)}
                lang={entry.language === "auto" ? "AUTO" : entry.language.toUpperCase()}
              />
            </View>
          ))
        )}
      </ScrollView>

      {/* ─── Bottom mic panel ───────────────────────────────────── */}
      <View style={styles.micPanel}>
        {/* Mic visual area — 88pt tall slot. In idle/error the MicButton is
            the visible element; in recording/transcribing the MicButton is
            hidden (opacity 0) BUT STAYS MOUNTED so the Pressable instance
            continues tracking the in-flight touch through the
            idle→recording transition, and the wave is overlaid in the same
            slot. Matches design M-A-1 (button) ↔ M-A-2 (wave replaces button)
            ↔ M-A-3 (frozen wave + spinner row replaces button). */}
        <View style={styles.micVisualArea}>
          <MicButton
            size={88}
            state={micButtonState}
            slash={micBlocked}
            onPressIn={() => {
              if (lockedFromKeyboard) return
              void onPressIn()
            }}
            onPressOut={() => {
              if (lockedFromKeyboard) return
              void onPressOut()
            }}
            style={micPhase === "idle" || micPhase === "error" ? undefined : styles.micButtonHidden}
          />
          {micPhase === "recording" && (
            <View style={styles.waveOverlay} pointerEvents="none">
              <LiveWave width={260} height={56} bars={32} level={recorder.level} />
            </View>
          )}
          {micPhase === "transcribing" && (
            <View style={styles.waveOverlay} pointerEvents="none">
              <WaveformFrozen width={260} height={56} bars={32} />
            </View>
          )}
          {micPhase === "loading" && (
            <View style={styles.waveOverlay} pointerEvents="none">
              <ActivityIndicator color={tokens.ink2} size="small" />
            </View>
          )}
        </View>
        {micPhase === "transcribing" ? (
          <View style={styles.transcribingRow}>
            <ActivityIndicator color={tokens.ink} size="small" />
            <Text style={styles.transcribingLabel}>Transcribing…</Text>
          </View>
        ) : (
          <View style={styles.micLabelBlock}>
            <Text style={styles.micLabel}>
              {micBlocked
                ? "Microphone unavailable"
                : micLabel(micPhase, lockedFromKeyboard, transcriber.progress)}
            </Text>
            <Text style={styles.micSubLabel}>
              {micBlocked
                ? "Tap Open Settings above"
                : micSubLabel(micPhase, languageLabel, recordingElapsedSec)}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

function micLabel(
  phase: "idle" | "recording" | "transcribing" | "loading" | "error",
  lockedFromKeyboard: boolean,
  progress: number | null,
): string {
  if (lockedFromKeyboard) return "Recording from keyboard…"
  if (phase === "loading") {
    return progress !== null ? `Loading model · ${Math.round(progress)}%` : "Loading model…"
  }
  if (phase === "error") return "Model failed to load"
  if (phase === "recording") return "Listening…"
  if (phase === "transcribing") return "Transcribing…"
  return "Tap and hold to speak"
}

function micSubLabel(
  phase: "idle" | "recording" | "transcribing" | "loading" | "error",
  languageLabel: string,
  recordingElapsedSec: number,
): string {
  if (phase === "recording") {
    const m = Math.floor(recordingElapsedSec / 60)
    const s = recordingElapsedSec % 60
    return `${m}:${s.toString().padStart(2, "0")} · HOLD TO KEEP RECORDING`
  }
  if (phase === "transcribing") return "Processing on this device"
  if (phase === "error") return "Restart opennib to retry"
  if (phase === "loading") return "First run only — happens on this device"
  return languageLabel
}

function describeWhen(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatDuration(ms: number): string {
  if (ms <= 0) return ""
  const total = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

/**
 * Placeholder card rendered at the top of the transcripts list while a
 * transcription is in flight. Matches the M-A-3 skeleton frame — three
 * faded body lines + a small meta bar — so users see "something is on its
 * way" rather than the list staying static during processing.
 */
function SkeletonCard() {
  return (
    <View style={skeletonStyles.root}>
      <View style={skeletonStyles.metaRow}>
        <View style={skeletonStyles.metaBar} />
        <View style={skeletonStyles.copyDot} />
      </View>
      <View style={[skeletonStyles.line, { width: "100%" }]} />
      <View style={[skeletonStyles.line, { width: "92%" }]} />
      <View style={[skeletonStyles.line, { width: "64%" }]} />
    </View>
  )
}

const skeletonStyles = StyleSheet.create({
  root: {
    backgroundColor: tokens.card,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    borderRadius: 14,
    gap: 6,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  metaBar: { width: 110, height: 10, borderRadius: 5, backgroundColor: tokens.hair, opacity: 0.7 },
  copyDot: { width: 18, height: 18, borderRadius: 4, backgroundColor: tokens.hair, opacity: 0.7 },
  line: { height: 12, borderRadius: 6, backgroundColor: tokens.hair, opacity: 0.7 },
})

function describeLanguage(tag: string): string {
  const entry = SUPPORTED_LANGUAGES.find((l) => l.tag === tag)
  if (entry === undefined) return tag.toUpperCase()
  if (entry.tag === "auto") return "Auto-detect"
  return entry.displayName
}

function bannerFor(remoteSource: RemoteSource): string | null {
  if (remoteSource === "keyboard") return "Recording for keyboard — text will appear in your app."
  if (remoteSource === "deeplink")
    return "From keyboard — hold the mic, then swipe back to your app."
  return null
}

type SetupBannerKind = "mic-denied" | "mic-undetermined" | "keyboard-missing"

/**
 * Mic permission outranks keyboard install because mic blocks dictation
 * outright; an unenabled keyboard still leaves the in-app button working.
 * Returns null when everything is set up or when we can't tell (e.g. Android,
 * or the SharedGroup native module isn't available).
 */
function setupBannerFor(
  microphone: "granted" | "denied" | "undetermined" | "loading",
  keyboardActivated: boolean | null,
): SetupBannerKind | null {
  if (microphone === "denied") return "mic-denied"
  if (microphone === "undetermined") return "mic-undetermined"
  if (keyboardActivated === false) return "keyboard-missing"
  return null
}

function setupBannerCopy(kind: SetupBannerKind): {
  title: string
  body: string
  action: string
} {
  switch (kind) {
    case "mic-denied":
      return {
        title: "Microphone access blocked",
        body: "opennib needs the microphone to dictate. Enable it in Settings.",
        action: "Open Settings",
      }
    case "mic-undetermined":
      return {
        title: "Allow microphone access",
        body: "Tap to grant permission so opennib can hear you.",
        action: "Allow",
      }
    case "keyboard-missing":
      return {
        title: "Finish keyboard setup",
        body: "Add the opennib keyboard and switch to it once to activate dictation in other apps.",
        action: "Open Settings",
      }
  }
}

async function runSetupBannerAction(kind: SetupBannerKind): Promise<void> {
  if (kind === "mic-undetermined") {
    await Linking.openSettings()
    return
  }
  if (kind === "mic-denied") {
    await Linking.openSettings()
    return
  }
  try {
    await Linking.openURL(KEYBOARD_SETTINGS_URL)
  } catch {
    await Linking.openSettings()
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.paper,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: tokens.paper2,
    alignItems: "center",
    justifyContent: "center",
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "500",
    color: tokens.ink2,
    letterSpacing: -0.1,
  },
  gearButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: tokens.paper2,
    alignItems: "center",
    justifyContent: "center",
  },

  bannerWrap: { paddingHorizontal: 16, marginTop: 6 },

  transcripts: { flex: 1, marginTop: 8 },
  transcriptsContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  cardSpacing: { marginBottom: 10 },
  placeholder: {
    paddingVertical: 32,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  placeholderTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.ink2,
    marginBottom: 6,
  },
  placeholderBody: {
    fontSize: 13,
    color: tokens.ink3,
    textAlign: "center",
    lineHeight: 18,
  },

  micPanel: {
    // Design (M-A-1 DictationShell): rounded top + paper bg + shadow up only.
    // PDF measurement shows the idle panel ~120pt tall — tight padding +
    // no reserved waveform slot. paddingBottom 32 sits just above the iOS
    // home indicator (~34pt) with a small breathing margin; the home
    // indicator's own safe area is on the page bg, not inside the panel.
    paddingTop: 14,
    paddingBottom: 32,
    paddingHorizontal: 16,
    backgroundColor: tokens.paper,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.hair,
    alignItems: "center",
    gap: 8,
    shadowColor: tokens.ink,
    shadowOpacity: 0.06,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 8,
  },
  micVisualArea: {
    // 88pt slot — sized for the MicButton. The wave / spinner overlays sit
    // absolutely centered inside, so swapping content doesn't reflow the
    // panel and pressing through the (now invisible) MicButton still
    // releases the recording.
    width: 260,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  micButtonHidden: { opacity: 0 },
  waveOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  micLabelBlock: { alignItems: "center", marginTop: 10 },
  micLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: tokens.ink2,
    letterSpacing: -0.2,
  },
  micSubLabel: {
    fontFamily: monoFontFamily,
    fontSize: 11,
    color: tokens.ink3,
    marginTop: 6,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  transcribingRow: {
    height: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  transcribingLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.ink,
    letterSpacing: -0.2,
  },
})
