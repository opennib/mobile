import {
  StorageError,
  log,
  type History,
  type HistoryListOptions,
  type TranscriptEntry,
} from "@opennib/core"

import { bareWorker, BareWorkerError } from "../native/bare-worker"

/**
 * Hermes-side proxy for the Hypercore-backed history that lives inside the
 * opennib Bare worker. Mirrors `AsyncStorageHistory`'s extended shape
 * (`load` / `snapshot` / `onChange`) so `HistoryContext` and `useHistory`
 * keep working unchanged.
 *
 * Synchronous reads come from a Hermes-side cache; mutations send an RPC
 * to the worker and update the cache + emit. Cache is newest-first to match
 * the AsyncStorage adapter's contract and the desktop Hypercore adapter's
 * `list()` ordering.
 */
export class BareHistory implements History {
  private entries: readonly TranscriptEntry[] = []
  private listeners = new Set<(entries: readonly TranscriptEntry[]) => void>()
  private loaded = false

  async load(): Promise<void> {
    try {
      this.entries = await bareWorker.historyList()
    } catch (err) {
      if (err instanceof BareWorkerError) {
        throw new StorageError(`failed to load history: ${err.message}`, err)
      }
      throw err
    }
    this.loaded = true
  }

  snapshot(): readonly TranscriptEntry[] {
    return this.entries
  }

  /**
   * Re-read the log and notify subscribers. The worker-hosted pipeline
   * appends entries itself during `dictate`, so the host refreshes rather
   * than writing a duplicate.
   */
  async reload(): Promise<void> {
    await this.load()
    this.emit()
  }

  async append(entry: TranscriptEntry): Promise<void> {
    if (!this.loaded) {
      throw new StorageError("history used before load()")
    }
    try {
      await bareWorker.historyAppend(entry)
    } catch (err) {
      if (err instanceof BareWorkerError) {
        throw new StorageError(`history append failed: ${err.message}`, err)
      }
      throw err
    }
    this.entries = [entry, ...this.entries]
    this.emit()
  }

  async list(options?: HistoryListOptions): Promise<readonly TranscriptEntry[]> {
    if (!this.loaded) {
      throw new StorageError("history used before load()")
    }
    const limit = options?.limit ?? this.entries.length
    const before = options?.before
    let startIndex = 0
    if (before !== undefined) {
      const cursor = this.entries.findIndex((e) => e.id === before)
      if (cursor < 0) return []
      startIndex = cursor + 1
    }
    return this.entries.slice(startIndex, startIndex + limit)
  }

  async clear(): Promise<void> {
    if (!this.loaded) {
      throw new StorageError("history used before load()")
    }
    if (this.entries.length === 0) return
    try {
      await bareWorker.historyClear()
    } catch (err) {
      if (err instanceof BareWorkerError) {
        throw new StorageError(`history clear failed: ${err.message}`, err)
      }
      throw err
    }
    this.entries = []
    this.emit()
  }

  onChange(handler: (entries: readonly TranscriptEntry[]) => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.entries)
      } catch (err) {
        log.error("history listener threw", { error: describeError(err) })
      }
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
