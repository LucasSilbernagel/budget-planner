/**
 * useActiveProfile Hook
 *
 * Custom hook for accessing and managing the active profile in the Budget Planner application.
 * Provides convenient access to profile data and operations.
 *
 * Architecture: Built on top of useProfileStore (Zustand)
 * Data Sovereignty: Works with client-side storage for free tier, server sync for paid tier
 */

import {
  type ClientProfile,
  useActiveProfile as useActiveProfileBase,
  useActiveProfileId,
  useHasMultipleProfiles,
  useIsLoadingProfiles,
  useProfileCount,
  useProfileError,
  useProfileStore,
  useProfiles,
} from '../stores/profileStore'

// Re-export all store hooks for convenience
export {
  useProfiles,
  useActiveProfileId,
  useIsLoadingProfiles,
  useProfileError,
  useProfileCount,
  useHasMultipleProfiles,
}

// Store instance for direct access
export { useProfileStore }

// Type exports
export type { ClientProfile }

/**
 * Get the active profile with additional utility methods
 */
export function useActiveProfile(): ClientProfile | null {
  return useActiveProfileBase()
}

/**
 * Hook to get all profiles with active profile highlighted
 */
export function useProfilesWithActive(): {
  profiles: ClientProfile[]
  activeProfile: ClientProfile | null
  activeProfileId: string | null
} {
  const profiles = useProfiles()
  const activeProfileId = useActiveProfileId()
  const activeProfile = useActiveProfile()

  return {
    profiles,
    activeProfile,
    activeProfileId,
  }
}

/**
 * Hook for profile switching operations
 */
export function useProfileSwitcher() {
  const { switchProfile, activeProfileId } = useProfileStore()

  /**
   * Switch to a specific profile by ID
   */
  const switchToProfile = (profileId: string) => {
    // Get fresh state to check if profile exists
    const state = useProfileStore.getState()
    const profileExists = state.profiles.some((p) => p.id === profileId)

    if (!profileExists) {
      console.error(`[useActiveProfile] Profile ${profileId} not found`)
      return
    }

    switchProfile(profileId)
  }

  /**
   * Switch to the next profile in the list
   */
  const switchToNextProfile = () => {
    const state = useProfileStore.getState()
    const profiles = state.profiles
    if (profiles.length <= 1) return

    const currentIndex = profiles.findIndex((p) => p.id === activeProfileId)
    const nextIndex = (currentIndex + 1) % profiles.length
    // Modulo of a length > 1 always indexes a real element (including the
    // `currentIndex === -1` case, which lands on 0), but `noUncheckedIndexedAccess`
    // cannot prove it. Narrowed rather than asserted.
    const next = profiles[nextIndex]
    if (next) switchProfile(next.id)
  }

  /**
   * Switch to the previous profile in the list
   */
  const switchToPreviousProfile = () => {
    const state = useProfileStore.getState()
    const profiles = state.profiles
    if (profiles.length <= 1) return

    const currentIndex = profiles.findIndex((p) => p.id === activeProfileId)
    const previousIndex = (currentIndex - 1 + profiles.length) % profiles.length
    const previous = profiles[previousIndex]
    if (previous) switchProfile(previous.id)
  }

  return {
    switchToProfile,
    switchToNextProfile,
    switchToPreviousProfile,
  }
}

/**
 * Hook for profile CRUD operations
 */
export function useProfileManager() {
  const { addProfile, updateProfile, removeProfile, setProfiles, setLoading, setError } =
    useProfileStore()

  /**
   * Create a new profile
   */
  const createProfile = (
    profileData: Omit<ClientProfile, 'id' | 'userId'> & { userId: string }
  ) => {
    // Generate a temporary client-side UUID
    // Server will assign the real UUID when synced for paid tier
    // Use crypto.randomUUID with fallback for compatibility
    const generateUUID = (): string => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID()
      }
      // Fallback for environments without crypto.randomUUID
      // This is a simplified UUID v4 generator
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    }

    const newProfile: ClientProfile = {
      ...profileData,
      id: generateUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    addProfile(newProfile)
    return newProfile
  }

  /**
   * Update an existing profile
   */
  const modifyProfile = (
    profileId: string,
    updates: Omit<Partial<ClientProfile>, 'createdAt' | 'updatedAt'>
  ) => {
    const timestamp = new Date().toISOString()
    updateProfile(profileId, {
      ...updates,
      updatedAt: timestamp,
    } as Partial<ClientProfile>)
  }

  /**
   * Delete a profile
   */
  const deleteProfile = (profileId: string) => {
    return removeProfile(profileId)
  }

  /**
   * Set profiles from server (for paid tier sync)
   */
  const syncProfilesFromServer = (serverProfiles: ClientProfile[]) => {
    setLoading(true)
    setError(null)
    try {
      setProfiles(serverProfiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync profiles')
    } finally {
      setLoading(false)
    }
  }

  return {
    createProfile,
    modifyProfile,
    deleteProfile,
    syncProfilesFromServer,
  }
}

/**
 * Hook to get profile by ID
 */
export function useProfileById(profileId: string | null): ClientProfile | null {
  const profiles = useProfiles()

  if (profileId === null) return null

  return profiles.find((p) => p.id === profileId) ?? null
}

/**
 * Hook to check if a specific profile is active
 */
export function useIsProfileActive(profileId: string): boolean {
  const activeProfileId = useActiveProfileId()
  return activeProfileId === profileId
}

/**
 * Hook to get the default profile
 */
export function useDefaultProfile(): ClientProfile | null {
  const profiles = useProfiles()
  return profiles.find((p) => p.isDefault) ?? null
}
