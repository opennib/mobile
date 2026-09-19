import { DeviceEventEmitter, type EmitterSubscription, NativeModules, Platform } from "react-native"

export type KeyboardSignal = "opennib:recordStart"

export interface KeyboardReadyEvent {
  readonly wavPath: string
}

interface OpennibKeyboardModule {
  resolveTranscript(text: string): void
  setListenerReady(ready: boolean): void
}

/**
 * Tracks how many keyboard listeners are subscribed on the JS side. The native
 * IME consults this (via `OpennibKeyboardBridge.isJsListening`) to decide
 * whether to emit `recordReady` (which needs a JS consumer) or fall through to
 * the cold-start "open opennib" hint. This matters when the user dismisses
 * opennib from recents: the React tree unmounts and these listeners detach,
 * but the app process can still be alive via the keepalive foreground service,
 * so a plain `hasReactContext` check is no longer reliable.
 */
let listenerCount = 0

function setNativeListenerReady(ready: boolean): void {
  if (Platform.OS !== "android") return
  const m = NativeModules["OpennibKeyboard"] as OpennibKeyboardModule | undefined
  if (m === undefined || typeof m.setListenerReady !== "function") return
  m.setListenerReady(ready)
}

function bumpListenerCount(delta: number): void {
  if (Platform.OS !== "android") return
  const prev = listenerCount
  listenerCount = Math.max(0, prev + delta)
  if (prev === 0 && listenerCount > 0) setNativeListenerReady(true)
  else if (prev > 0 && listenerCount === 0) setNativeListenerReady(false)
}

/**
 * Subscribes to a fire-and-forget signal from the Android opennib IME.
 * Currently used for `opennib:recordStart` so the JS side can update its UI
 * (mark itself "recording from keyboard"). Audio is captured natively inside
 * the IME — JS does not start the mic on this signal. iOS uses Darwin
 * notifications via `addSharedGroupListener`.
 */
export function addKeyboardEventListener(
  eventName: KeyboardSignal,
  handler: () => void,
): { remove(): void } {
  if (Platform.OS !== "android") {
    return { remove: () => {} }
  }
  const sub: EmitterSubscription = DeviceEventEmitter.addListener(eventName, handler)
  bumpListenerCount(1)
  let removed = false
  return {
    remove: () => {
      if (removed) return
      removed = true
      sub.remove()
      bumpListenerCount(-1)
    },
  }
}

/**
 * Subscribes to the Android IME's `opennib:recordReady` event, which fires
 * when the IME has finished capturing audio and written a WAV file. The
 * payload carries the absolute on-disk path. JS hands that path straight to
 * the transcriber and pushes the resulting text back via
 * `resolveKeyboardTranscript`.
 */
export function addKeyboardReadyListener(handler: (event: KeyboardReadyEvent) => void): {
  remove(): void
} {
  if (Platform.OS !== "android") {
    return { remove: () => {} }
  }
  const sub: EmitterSubscription = DeviceEventEmitter.addListener(
    "opennib:recordReady",
    (raw: unknown) => {
      if (raw === null || typeof raw !== "object") {
        console.warn("[kbd] recordReady: bad payload", raw)
        return
      }
      const wavPath = (raw as { wavPath?: unknown }).wavPath
      if (typeof wavPath !== "string" || wavPath.length === 0) {
        console.warn("[kbd] recordReady: missing wavPath", raw)
        return
      }
      handler({ wavPath })
    },
  )
  bumpListenerCount(1)
  let removed = false
  return {
    remove: () => {
      if (removed) return
      removed = true
      sub.remove()
      bumpListenerCount(-1)
    },
  }
}

/**
 * Hands a finished transcript back to the Android IME so it can insert it via
 * `commitText` and reset its status. Pass an empty string to just reset the
 * label (e.g. when transcription failed).
 */
export function resolveKeyboardTranscript(text: string): void {
  if (Platform.OS !== "android") return
  const m = NativeModules["OpennibKeyboard"] as OpennibKeyboardModule | undefined
  if (m === undefined || typeof m.resolveTranscript !== "function") {
    console.warn("[kbd] resolveTranscript: native module missing")
    return
  }
  console.info("[kbd] resolveTranscript", { len: text.length })
  m.resolveTranscript(text)
}
