import { useCallback, useEffect, useState } from "react"

import { getSharedGroup } from "../native/shared-group"

/**
 * `null` means we can't tell — typically Android or simulator builds without
 * the iOS keyboard plugin. Treat null as "don't show a banner" because we have
 * no signal either way.
 */
export type KeyboardActivationStatus = boolean | null

interface UseKeyboardStatus {
  readonly everActivated: KeyboardActivationStatus
  refresh(): Promise<void>
}

/**
 * Tracks whether the iOS keyboard extension has ever been displayed inside a
 * host app. Backed by the App Group sentinel `keyboardEverActivated` written
 * by `KeyboardViewController.viewDidAppear`.
 */
export function useKeyboardStatus(): UseKeyboardStatus {
  const [everActivated, setEverActivated] = useState<KeyboardActivationStatus>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const sharedGroup = getSharedGroup()
    if (sharedGroup === null) {
      setEverActivated(null)
      return
    }
    try {
      const value = await sharedGroup.readKeyboardActivated()
      setEverActivated(value)
    } catch {
      setEverActivated(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { everActivated, refresh }
}
