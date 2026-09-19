import { StorageError, log, type Dictionary, type DictionaryEntry } from "@opennib/core"

import { bareWorker, BareWorkerError } from "../native/bare-worker"

/**
 * Hermes-side proxy for the Hypercore-backed dictionary that lives inside the
 * opennib Bare worker. Mirrors `AsyncStorageDictionary`'s shape
 * (`load` / `snapshot` / `onChange`) so `DictionaryContext` and `useDictionary`
 * keep working unchanged.
 *
 * The worker materializes the active set by folding its append-only event
 * log; we cache that materialized view on Hermes for synchronous reads and
 * refresh it after each mutation. We refresh (rather than mutate optimistically)
 * because the worker is the source of truth for the fold and may differ from
 * a naive optimistic update if a concurrent mutation slipped in.
 */
export class BareDictionary implements Dictionary {
  private entries: readonly DictionaryEntry[] = []
  private listeners = new Set<(entries: readonly DictionaryEntry[]) => void>()
  private loaded = false

  async load(): Promise<void> {
    await this.refresh()
    this.loaded = true
  }

  snapshot(): readonly DictionaryEntry[] {
    return this.entries
  }

  async list(): Promise<readonly DictionaryEntry[]> {
    if (!this.loaded) {
      throw new StorageError("dictionary used before load()")
    }
    return this.entries
  }

  async add(entry: DictionaryEntry): Promise<void> {
    if (!this.loaded) {
      throw new StorageError("dictionary used before load()")
    }
    try {
      await bareWorker.dictionaryAdd(entry)
    } catch (err) {
      if (err instanceof BareWorkerError) {
        throw new StorageError(`dictionary add failed: ${err.message}`, err)
      }
      throw err
    }
    await this.refresh()
    this.emit()
  }

  async remove(id: string): Promise<void> {
    if (!this.loaded) {
      throw new StorageError("dictionary used before load()")
    }
    try {
      await bareWorker.dictionaryRemove(id)
    } catch (err) {
      if (err instanceof BareWorkerError) {
        throw new StorageError(`dictionary remove failed: ${err.message}`, err)
      }
      throw err
    }
    await this.refresh()
    this.emit()
  }

  async clear(): Promise<void> {
    if (!this.loaded) {
      throw new StorageError("dictionary used before load()")
    }
    if (this.entries.length === 0) return
    try {
      await bareWorker.dictionaryClear()
    } catch (err) {
      if (err instanceof BareWorkerError) {
        throw new StorageError(`dictionary clear failed: ${err.message}`, err)
      }
      throw err
    }
    this.entries = []
    this.emit()
  }

  onChange(handler: (entries: readonly DictionaryEntry[]) => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.entries = await bareWorker.dictionaryList()
    } catch (err) {
      if (err instanceof BareWorkerError) {
        throw new StorageError(`failed to load dictionary: ${err.message}`, err)
      }
      throw err
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.entries)
      } catch (err) {
        log.error("dictionary listener threw", { error: describeError(err) })
      }
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
