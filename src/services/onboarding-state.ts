import { StorageError } from "@opennib/core"

const STORAGE_KEY = "opennib.onboarding.v1"
const STORAGE_VERSION = 1

interface PersistedOnboarding {
  readonly version: number
  readonly completed: boolean
  readonly completedAt: number | null
}

export interface OnboardingSnapshot {
  readonly completed: boolean
  readonly completedAt: number | null
}

export interface OnboardingStorageLike {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface OnboardingStateOptions {
  readonly storage: OnboardingStorageLike
}

const DEFAULT_SNAPSHOT: OnboardingSnapshot = { completed: false, completedAt: null }

/**
 * Tiny one-key wrapper over AsyncStorage. Kept separate from `Settings`
 * because `Settings` is a typed user-portable surface (synced in v0.5+), and
 * onboarding completion is strictly device-local installation state — it
 * should never travel to a paired device.
 */
export class OnboardingState {
  private snapshot: OnboardingSnapshot = DEFAULT_SNAPSHOT
  private hydrated = false

  constructor(private readonly options: OnboardingStateOptions) {}

  async load(): Promise<OnboardingSnapshot> {
    try {
      const raw = await this.options.storage.getItem(STORAGE_KEY)
      this.snapshot = parsePersisted(raw)
    } catch (e) {
      throw new StorageError(`failed to load onboarding state: ${describeError(e)}`, e)
    }
    this.hydrated = true
    return this.snapshot
  }

  current(): OnboardingSnapshot {
    if (!this.hydrated) {
      throw new StorageError("OnboardingState used before load()")
    }
    return this.snapshot
  }

  async markCompleted(): Promise<OnboardingSnapshot> {
    const next: OnboardingSnapshot = { completed: true, completedAt: Date.now() }
    await this.persist(next)
    this.snapshot = next
    return next
  }

  async reset(): Promise<OnboardingSnapshot> {
    try {
      await this.options.storage.removeItem(STORAGE_KEY)
    } catch (e) {
      throw new StorageError(`failed to reset onboarding state: ${describeError(e)}`, e)
    }
    this.snapshot = DEFAULT_SNAPSHOT
    return this.snapshot
  }

  private async persist(snapshot: OnboardingSnapshot): Promise<void> {
    const payload: PersistedOnboarding = {
      version: STORAGE_VERSION,
      completed: snapshot.completed,
      completedAt: snapshot.completedAt,
    }
    try {
      await this.options.storage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (e) {
      throw new StorageError(`failed to persist onboarding state: ${describeError(e)}`, e)
    }
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function parsePersisted(raw: string | null): OnboardingSnapshot {
  if (raw === null) return DEFAULT_SNAPSHOT
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedOnboarding>
    if (parsed.version !== STORAGE_VERSION) return DEFAULT_SNAPSHOT
    return {
      completed: parsed.completed === true,
      completedAt: typeof parsed.completedAt === "number" ? parsed.completedAt : null,
    }
  } catch {
    return DEFAULT_SNAPSHOT
  }
}
