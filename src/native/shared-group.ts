import type { NativeModule } from "react-native"
import { NativeEventEmitter, NativeModules } from "react-native"

/**
 * Native module bridge to the iOS keyboard extension via App Group +
 * Darwin notifications. Implemented in `ios-shared/SharedGroup.m` and wired
 * into the host target by `plugins/with-shared-group-module.cjs`.
 *
 * Returns null when the native module is unavailable (Android, simulator
 * builds without the keyboard plugin, or pre-prebuild dev). Callers must
 * handle the null case rather than asserting presence.
 */
export interface SharedGroupModule {
  /** Stamp the heartbeat key in the App Group so the keyboard knows we're alive. */
  heartbeat(): Promise<void>
  /** Write a transcript into the App Group and signal the keyboard to insert it. */
  writeTranscript(text: string): Promise<number>
  /**
   * Publish the live mic level (0..1) for the keyboard's waveform while a
   * keyboard-triggered recording runs. Fire-and-forget, ~12 fps.
   */
  writeAudioLevel(level: number): void
  /**
   * True once the keyboard extension has been displayed at least once inside a
   * host app — i.e. the user finished iOS keyboard setup and switched to it.
   */
  readKeyboardActivated(): Promise<boolean>
}

export type SharedGroupEvent = "recordStart" | "recordStop"

interface SharedGroupNative extends NativeModule, SharedGroupModule {}

interface NativeBindings {
  readonly module: SharedGroupModule
  readonly emitter: NativeEventEmitter
}

const native: NativeBindings | null = (() => {
  const raw = NativeModules["SharedGroup"] as SharedGroupNative | undefined
  if (raw === undefined || raw === null) return null
  return { module: raw, emitter: new NativeEventEmitter(raw) }
})()

export function getSharedGroup(): SharedGroupModule | null {
  return native?.module ?? null
}

export function addSharedGroupListener(
  event: SharedGroupEvent,
  listener: () => void,
): { remove(): void } {
  if (native === null) return { remove() {} }
  const sub = native.emitter.addListener(event, listener)
  return { remove: () => sub.remove() }
}
