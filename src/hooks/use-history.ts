import { createContext, useContext, useEffect, useState } from "react"
import type { TranscriptEntry } from "@opennib/core"

import type { BareHistory } from "../services/bare-history"

/**
 * Provided by `App.tsx` after `BareHistory.load()` resolves so the tree
 * never sees an unloaded store. `null` is the pre-hydration sentinel that
 * consumers gate on.
 */
export const HistoryContext = createContext<BareHistory | null>(null)

interface UseHistoryReady {
  readonly ready: true
  readonly entries: readonly TranscriptEntry[]
  append(entry: TranscriptEntry): Promise<void>
  /** Re-read from the worker after it appended entries itself (dictate). */
  reload(): Promise<void>
  clear(): Promise<void>
}

interface UseHistoryPending {
  readonly ready: false
}

export type UseHistory = UseHistoryReady | UseHistoryPending

/**
 * React-side view of the transcript log. Subscribes to `onChange` so any
 * append/clear from anywhere keeps the UI in sync without manual refreshes.
 */
export function useHistory(): UseHistory {
  const history = useContext(HistoryContext)
  const [entries, setEntries] = useState<readonly TranscriptEntry[] | null>(
    history === null ? null : history.snapshot(),
  )

  useEffect(() => {
    if (history === null) return
    setEntries(history.snapshot())
    return history.onChange((next) => setEntries(next))
  }, [history])

  if (history === null || entries === null) {
    return { ready: false }
  }

  return {
    ready: true,
    entries,
    append: (entry) => history.append(entry),
    reload: () => history.reload(),
    clear: () => history.clear(),
  }
}
