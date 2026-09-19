import { useCallback, useEffect, useState } from "react"
import { Audio } from "expo-av"
import type { PermissionState } from "@opennib/core"

import { ExpoPermissions } from "../services/expo-permissions"

export type MicrophoneStatus = PermissionState | "loading"

interface UsePermissions {
  readonly microphone: MicrophoneStatus
  /** Re-check the current OS-level state — call after returning from Settings. */
  refresh(): Promise<void>
  /** Trigger the system permission prompt. Returns the resulting state. */
  requestMicrophone(): Promise<PermissionState>
}

/**
 * Mobile permissions hook backed by `ExpoPermissions`. Mirrors the desktop
 * pattern of holding state on the React side and re-querying when the user
 * returns from a system settings screen.
 */
export function usePermissions(): UsePermissions {
  const [microphone, setMicrophone] = useState<MicrophoneStatus>("loading")

  const refresh = useCallback(async (): Promise<void> => {
    const adapter = new ExpoPermissions({ audio: Audio })
    const next = await adapter.microphone()
    setMicrophone(next)
  }, [])

  const requestMicrophone = useCallback(async (): Promise<PermissionState> => {
    const adapter = new ExpoPermissions({ audio: Audio })
    const next = await adapter.requestMicrophone()
    setMicrophone(next)
    return next
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { microphone, refresh, requestMicrophone }
}
