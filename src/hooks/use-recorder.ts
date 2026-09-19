import { useRef, useState } from "react"
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av"

/**
 * 16 kHz mono 16-bit LINEARPCM WAV — Whisper's preferred input format. Both
 * `@qvac/sdk`'s whisper plugin expects this.
 * Bit rate is the encoded-stream rate (sampleRate * channels * bitDepth) and
 * is informational on iOS LinearPCM, so 256000 is just a sanity value.
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  // Metering drives the LiveWave bars on the home screen so they react to
  // mic input instead of looping a dummy animation. The flag toggles
  // status-update callbacks; we leave audio mode + format settings exactly
  // as validated on device — those are what break
  // recording when changed.
  isMeteringEnabled: true,
  android: {
    extension: ".wav",
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16_000,
    numberOfChannels: 1,
    bitRate: 256_000,
  },
  ios: {
    extension: ".wav",
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16_000,
    numberOfChannels: 1,
    bitRate: 256_000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
}

interface UseRecorder {
  readonly isRecording: boolean
  readonly error: string | null
  /** 0..1 normalised mic level from the active recording; 0 when idle. */
  readonly level: number
  start(): Promise<void>
  /** Returns the absolute on-disk path of the recorded WAV (no `file://` prefix), or null if nothing was captured. */
  stop(): Promise<string | null>
}

/**
 * Map expo-av's `metering` (dBFS, roughly -160..0) to a 0..1 visual level.
 * -60 dB is below typical room noise, 0 dB is digital peak; linear interp
 * between those gives bars that move with the voice and rest near the floor
 * during silence.
 */
function meteringToLevel(db: number | undefined): number {
  if (db === undefined || !Number.isFinite(db)) return 0
  const normalised = (db + 60) / 60
  if (normalised <= 0) return 0
  if (normalised >= 1) return 1
  return normalised
}

/**
 * Push-to-talk recorder for iOS + Android via `expo-av`. Mirrors the
 * reference `useRecorder` implementation because that pattern has
 * already been validated end-to-end against `@qvac/sdk`'s whisper plugin —
 * the WAV file path returned by `stop()` is fed straight into
 * `transcribe({ audioChunk: <path> })` (see use-transcriber.ts).
 *
 * The retry-on-prepare branch handles a quirk of expo-av: it enforces a
 * global `Audio.Recording` singleton, and a stale instance from a hot
 * reload or aborted start can leave the new prepare call wedged.
 */
export function useRecorder(): UseRecorder {
  const recordingRef = useRef<Audio.Recording | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)

  async function ensurePermission(): Promise<void> {
    const { status } = await Audio.requestPermissionsAsync()
    if (status !== "granted") {
      throw new Error("microphone permission denied")
    }
    // `staysActiveInBackground` without an explicit interruption mode leaves
    // AVAudioSession in a state where AVAudioRecorder fails to init with
    // E_AUDIO_RECORDERNOTCREATED. Set the full mode bag.
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    })
  }

  /**
   * Create, wire, and register a Recording in one step. The instance lands in
   * `recordingRef` BEFORE prepare/start run, so any failure path (including
   * `startAsync` throwing after a successful prepare) leaves it reachable for
   * cleanup. An orphaned prepared instance wedges expo-av's global singleton:
   * every later prepare fails with "Only one Recording can be prepared at a
   * given time" until app restart.
   */
  async function prepareAndStart(): Promise<void> {
    const recording = new Audio.Recording()
    recordingRef.current = recording
    // `setProgressUpdateInterval` taps the rate of metering callbacks;
    // 80 ms (~12 fps) is smooth enough for the wave + cheap on Hermes.
    recording.setProgressUpdateInterval(80)
    recording.setOnRecordingStatusUpdate((status) => {
      if (status.isRecording) {
        setLevel(meteringToLevel(status.metering))
      }
    })
    await recording.prepareToRecordAsync(RECORDING_OPTIONS)
    await recording.startAsync()
  }

  async function unloadCurrent(): Promise<void> {
    const rec = recordingRef.current
    recordingRef.current = null
    if (rec === null) return
    try {
      await rec.stopAndUnloadAsync()
    } catch {
      // Best-effort: already-unloaded or never-prepared instances throw here,
      // and there is nothing further to release for them.
    }
  }

  async function start(): Promise<void> {
    try {
      setError(null)
      await ensurePermission()
      // Clear any stale instance (hot reload, aborted previous cycle).
      await unloadCurrent()
      try {
        await prepareAndStart()
      } catch {
        // expo-av quirk: a wedged singleton from an earlier aborted start can
        // fail the first prepare; unload whatever we hold and retry once.
        await unloadCurrent()
        await prepareAndStart()
      }
      setIsRecording(true)
    } catch (e) {
      // Never leave a half-prepared instance behind on failure.
      await unloadCurrent()
      setError(errorMessage(e))
      setIsRecording(false)
      throw e
    }
  }

  async function stop(): Promise<string | null> {
    const rec = recordingRef.current
    recordingRef.current = null
    setIsRecording(false)
    setLevel(0)
    if (rec === null) return null
    try {
      await rec.stopAndUnloadAsync()
      const uri = rec.getURI()
      return uri !== null && uri !== undefined ? uri.replace("file://", "") : null
    } catch (e) {
      setError(errorMessage(e))
      return null
    }
  }

  return { isRecording, error, level, start, stop }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
