import {
  DEFAULT_SETTINGS_SNAPSHOT,
  StorageError,
  log,
  parseSettingsSnapshot,
  type LanguageTag,
  type Settings,
  type SettingsSnapshot,
} from "@opennib/core"

const STORAGE_KEY = "opennib.settings.v1"

/**
 * Mobile-only host settings. The desktop host slice (hotkey, tray toggles,
 * launch-at-login, dock) has no meaning on mobile — dictation triggers off the
 * keyboard extension / IME tap, not a system hotkey, and onboarding state lives
 * in its own `OnboardingState` service. All mobile needs on top of the core
 * dictation slice is the two sound toggles, and they persist in the SAME
 * AsyncStorage blob so existing installs migrate for free.
 */
export interface MobileHostSettingsSnapshot {
  /**
   * Play a quiet tick when recording starts/ends. Off by default — most
   * users find recording status sufficiently indicated by the on-screen state.
   */
  readonly dictationSounds: boolean
  /**
   * Play an alert sound when opennib surfaces an error (missing mic, etc.).
   * Off by default.
   */
  readonly notificationSounds: boolean
}

/**
 * Combined settings view — the dictation slice core owns plus the mobile host
 * slice. This is the shape the React UI reads and the on-disk blob shape;
 * keeping them identical means existing AsyncStorage values need no migration.
 */
export type MobileSettingsSnapshot = SettingsSnapshot & MobileHostSettingsSnapshot

export const DEFAULT_MOBILE_HOST_SETTINGS_SNAPSHOT: MobileHostSettingsSnapshot = {
  dictationSounds: false,
  notificationSounds: false,
}

/**
 * Parse the mobile host slice from arbitrary input (the same object core's
 * `parseSettingsSnapshot` reads). Missing fields and wrong types fall back to
 * the default for that field — mirroring core's tolerant style.
 */
export function parseMobileHostSettingsSnapshot(raw: unknown): MobileHostSettingsSnapshot {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_MOBILE_HOST_SETTINGS_SNAPSHOT
  }
  const partial = raw as Partial<MobileHostSettingsSnapshot>
  return {
    dictationSounds:
      typeof partial.dictationSounds === "boolean"
        ? partial.dictationSounds
        : DEFAULT_MOBILE_HOST_SETTINGS_SNAPSHOT.dictationSounds,
    notificationSounds:
      typeof partial.notificationSounds === "boolean"
        ? partial.notificationSounds
        : DEFAULT_MOBILE_HOST_SETTINGS_SNAPSHOT.notificationSounds,
  }
}

/**
 * Slice of `@react-native-async-storage/async-storage` we depend on. Defining
 * it as an interface keeps the adapter testable without importing native
 * modules and lets the test inject a fake.
 */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export interface AsyncStorageSettingsOptions {
  readonly storage: AsyncStorageLike
}

/**
 * Mobile equivalent of `JsonFileSettings`. Implements core's dictation
 * `Settings` and layers the mobile host slice (sound toggles) on top. Both
 * persist to ONE AsyncStorage key holding a combined JSON blob. `load()` must
 * be awaited once at boot before any synchronous getter is called; the
 * in-memory snapshot stays authoritative thereafter and writes persist
 * asynchronously. `appSnapshot()` returns the combined view for the UI.
 */
export class AsyncStorageSettings implements Settings {
  private core: SettingsSnapshot = DEFAULT_SETTINGS_SNAPSHOT
  private host: MobileHostSettingsSnapshot = DEFAULT_MOBILE_HOST_SETTINGS_SNAPSHOT
  private coreListeners = new Set<(s: SettingsSnapshot) => void>()
  private appListeners = new Set<(s: MobileSettingsSnapshot) => void>()
  private loaded = false

  constructor(private readonly options: AsyncStorageSettingsOptions) {}

  async load(): Promise<void> {
    try {
      const raw = await this.options.storage.getItem(STORAGE_KEY)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        this.core = parseSettingsSnapshot(parsed)
        this.host = parseMobileHostSettingsSnapshot(parsed)
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        log.warn("settings storage value unparseable, falling back to defaults", {
          error: err.message,
        })
      } else {
        throw new StorageError(`failed to load settings: ${describeError(err)}`, err)
      }
    }
    this.loaded = true
  }

  whisperModelId(): string {
    return this.core.whisperModelId
  }

  language(): LanguageTag {
    return this.core.language
  }

  cleanupEnabled(): boolean {
    return this.core.cleanupEnabled
  }

  llmModelId(): string | null {
    return this.core.llmModelId
  }

  dictationSounds(): boolean {
    return this.host.dictationSounds
  }

  notificationSounds(): boolean {
    return this.host.notificationSounds
  }

  snapshot(): SettingsSnapshot {
    return this.core
  }

  /** Combined dictation + host view. This is the UI / on-disk shape. */
  appSnapshot(): MobileSettingsSnapshot {
    return { ...this.core, ...this.host }
  }

  async setWhisperModelId(id: string): Promise<void> {
    await this.updateCore({ whisperModelId: id })
  }

  async setLanguage(language: LanguageTag): Promise<void> {
    await this.updateCore({ language })
  }

  async setCleanupEnabled(enabled: boolean): Promise<void> {
    await this.updateCore({ cleanupEnabled: enabled })
  }

  async setLlmModelId(id: string | null): Promise<void> {
    await this.updateCore({ llmModelId: id })
  }

  async setDictationSounds(value: boolean): Promise<void> {
    await this.updateHost({ dictationSounds: value })
  }

  async setNotificationSounds(value: boolean): Promise<void> {
    await this.updateHost({ notificationSounds: value })
  }

  onChange(handler: (snapshot: SettingsSnapshot) => void): () => void {
    this.coreListeners.add(handler)
    return () => {
      this.coreListeners.delete(handler)
    }
  }

  /**
   * Subscribe to any change (dictation or host). Returns an unsubscribe
   * function. The React UI uses this so a sound-toggle flip re-renders even
   * though it isn't part of core's dictation snapshot.
   */
  onAppChange(handler: (snapshot: MobileSettingsSnapshot) => void): () => void {
    this.appListeners.add(handler)
    return () => {
      this.appListeners.delete(handler)
    }
  }

  private async updateCore(partial: Partial<SettingsSnapshot>): Promise<void> {
    if (!this.loaded) {
      throw new StorageError("settings used before load()")
    }
    const next: SettingsSnapshot = { ...this.core, ...partial }
    if (
      next.whisperModelId === this.core.whisperModelId &&
      next.language === this.core.language &&
      next.cleanupEnabled === this.core.cleanupEnabled &&
      next.llmModelId === this.core.llmModelId
    ) {
      return
    }
    this.core = next
    await this.persist()
    this.notify()
  }

  private async updateHost(partial: Partial<MobileHostSettingsSnapshot>): Promise<void> {
    if (!this.loaded) {
      throw new StorageError("settings used before load()")
    }
    const next: MobileHostSettingsSnapshot = { ...this.host, ...partial }
    if (
      next.dictationSounds === this.host.dictationSounds &&
      next.notificationSounds === this.host.notificationSounds
    ) {
      return
    }
    this.host = next
    await this.persist()
    this.notify()
  }

  private notify(): void {
    const core = this.core
    for (const listener of this.coreListeners) {
      try {
        listener(core)
      } catch (err) {
        log.error("settings listener threw", { error: describeError(err) })
      }
    }
    const app = this.appSnapshot()
    for (const listener of this.appListeners) {
      try {
        listener(app)
      } catch (err) {
        log.error("settings listener threw", { error: describeError(err) })
      }
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.options.storage.setItem(STORAGE_KEY, JSON.stringify(this.appSnapshot()))
    } catch (err) {
      throw new StorageError(`failed to persist settings: ${describeError(err)}`, err)
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
