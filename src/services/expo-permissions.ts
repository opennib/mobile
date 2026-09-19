import type { Permissions, PermissionState } from "@opennib/core"

/**
 * Slice of `expo-av`'s `Audio` we use. Defining it as an interface keeps the
 * adapter testable without importing native modules and lets the test inject
 * a fake.
 */
export interface ExpoAudioLike {
  getPermissionsAsync(): Promise<{ status: "granted" | "denied" | "undetermined" }>
  requestPermissionsAsync(): Promise<{ status: "granted" | "denied" | "undetermined" }>
}

export interface ExpoPermissionsOptions {
  readonly audio: ExpoAudioLike
}

/**
 * iOS / Android microphone permissions via `expo-av`. Accessibility is N/A on
 * mobile — the iOS keyboard extension model does not require it, and Android
 * IMEs use a separate permission surface that lands in v0.4.
 */
export class ExpoPermissions implements Permissions {
  constructor(private readonly options: ExpoPermissionsOptions) {}

  async microphone(): Promise<PermissionState> {
    const { status } = await this.options.audio.getPermissionsAsync()
    return mapStatus(status)
  }

  async requestMicrophone(): Promise<PermissionState> {
    const { status } = await this.options.audio.requestPermissionsAsync()
    return mapStatus(status)
  }
}

function mapStatus(status: "granted" | "denied" | "undetermined"): PermissionState {
  return status
}
