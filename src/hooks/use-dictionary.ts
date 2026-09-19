import { createContext, useContext, useEffect, useState } from "react"
import type { DictionaryEntry } from "@opennib/core"

import type { BareDictionary } from "../services/bare-dictionary"

/**
 * Provided by `App.tsx` after `BareDictionary.load()` resolves so the tree
 * never sees an unloaded store. `null` is the pre-hydration sentinel.
 */
export const DictionaryContext = createContext<BareDictionary | null>(null)

interface UseDictionaryReady {
  readonly ready: true
  readonly entries: readonly DictionaryEntry[]
  add(entry: DictionaryEntry): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

interface UseDictionaryPending {
  readonly ready: false
}

export type UseDictionary = UseDictionaryReady | UseDictionaryPending

export function useDictionary(): UseDictionary {
  const dictionary = useContext(DictionaryContext)
  const [entries, setEntries] = useState<readonly DictionaryEntry[] | null>(
    dictionary === null ? null : dictionary.snapshot(),
  )

  useEffect(() => {
    if (dictionary === null) return
    setEntries(dictionary.snapshot())
    return dictionary.onChange((next) => setEntries(next))
  }, [dictionary])

  if (dictionary === null || entries === null) {
    return { ready: false }
  }

  return {
    ready: true,
    entries,
    add: (entry) => dictionary.add(entry),
    remove: (id) => dictionary.remove(id),
    clear: () => dictionary.clear(),
  }
}
