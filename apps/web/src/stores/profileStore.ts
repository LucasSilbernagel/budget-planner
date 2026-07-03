/**
 * Profile Store
 *
 * Zustand store for managing user profiles in the Budget Planner application.
 * Handles active profile state, profile switching, and profile data.
 *
 * Architecture: Zustand with persistence middleware
 * Data Sovereignty: Profile data stored client-side for free tier, synced to DanubeData for paid tier
 */

import { canonicalizeCurrency } from '@budget-planner/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'

// Profile type definition
// Matches the userProfiles table structure from packages/db/src/schema.ts
export interface Profile {
  id: string
  userId: string
  name: string
  description?: string
  isDefault: boolean
  currency: string
  createdAt: string
  updatedAt: string
}

// Simplified profile for client-side storage (without sensitive data)
export interface ClientProfile {
  id: string
  userId: string
  name: string
  description?: string
  isDefault: boolean
  currency: string
  // Set by useProfileManager.createProfile / server sync. Optional because the
  // seeded DEFAULT_PROFILE and older persisted records may predate these fields.
  createdAt?: string
  updatedAt?: string
}

// Profile state interface
export interface ProfileState {
  // Array of profiles for the current user
  profiles: ClientProfile[]

  // Currently active profile ID
  activeProfileId: string | null

  // Loading state
  isLoading: boolean

  // Error state
  error: string | null

  // Actions
  setProfiles: (profiles: ClientProfile[]) => void
  setActiveProfileId: (profileId: string | null) => void
  addProfile: (profile: ClientProfile) => void
  updateProfile: (profileId: string, updates: Partial<ClientProfile>) => void
  removeProfile: (profileId: string) => void
  switchProfile: (profileId: string) => void
  setLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

// Helper to generate UUID with fallback
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Default profile for new users
// Note: For client-side only. Server will assign actual UUID when synced.
// userId is populated when the user is authenticated
const DEFAULT_PROFILE: ClientProfile = {
  id: generateUUID(),
  userId: '',
  name: 'Main Profile',
  description: 'Your primary financial profile',
  isDefault: true,
  currency: 'NONE',
}

// Create the profile store
export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      // Initial state
      profiles: [DEFAULT_PROFILE],
      activeProfileId: DEFAULT_PROFILE.id,
      isLoading: false,
      error: null,

      // Set all profiles for the user
      setProfiles: (profiles) => {
        set({
          profiles,
          // If active profile is not in the new list, set to first profile or null
          activeProfileId: profiles[0]?.id ?? null,
          isLoading: false,
          error: null,
        })
      },

      // Set the active profile ID
      setActiveProfileId: (profileId) => {
        set({ activeProfileId: profileId })
      },

      // Add a new profile
      addProfile: (rawProfile) => {
        // Canonicalize on write so the stored + synced record carries the
        // representative code (story 8-2). The app never converts currency —
        // it is a display-format preference — so this is a lossless relabel that
        // keeps state in step with the shrunk selector and the sync enum.
        const profile = {
          ...rawProfile,
          currency: canonicalizeCurrency(rawProfile.currency || 'NONE'),
        }
        const alreadyExists = get().profiles.some((p) => p.id === profile.id)
        set((state) => {
          // Check if profile already exists (by ID)
          const existingIndex = state.profiles.findIndex((p) => p.id === profile.id)

          if (existingIndex >= 0) {
            // Update existing profile
            const updatedProfiles = [...state.profiles]
            updatedProfiles[existingIndex] = { ...updatedProfiles[existingIndex], ...profile }
            return { profiles: updatedProfiles }
          }

          // Add new profile
          return { profiles: [...state.profiles, profile] }
        })
        // Paid tier: push to the server (no-op for the free tier).
        if (alreadyExists) {
          syncEntityUpdate('userProfile', profile)
        } else {
          syncEntityCreate('userProfile', profile)
        }
      },

      // Update an existing profile
      updateProfile: (profileId, rawUpdates) => {
        // Canonicalize an incoming currency change at the store boundary so no
        // consolidated code is ever persisted or synced (story 8-2).
        const updates =
          rawUpdates.currency === undefined
            ? rawUpdates
            : { ...rawUpdates, currency: canonicalizeCurrency(rawUpdates.currency || 'NONE') }
        const previous = get().profiles.find((profile) => profile.id === profileId)
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === profileId ? { ...profile, ...updates } : profile
          ),
        }))
        // Paid tier: queue the update.
        if (previous) {
          syncEntityUpdate('userProfile', { ...previous, ...updates }, previous)
        }
      },

      // Remove a profile
      removeProfile: (profileId: string) => {
        // Decide up front whether this removal will actually happen, so we only
        // queue a server tombstone for a real delete (the guards below reject
        // removing the last or the default profile).
        const before = get()
        const target = before.profiles.find((p) => p.id === profileId)
        const willRemove = before.profiles.length > 1 && target !== undefined && !target.isDefault
        set((state) => {
          // Prevent deletion of the last profile
          if (state.profiles.length <= 1) {
            return {
              error: 'Cannot delete the last profile. Create a new profile first.',
            }
          }

          // Prevent deletion of the default profile
          const profileToDelete = state.profiles.find((p) => p.id === profileId)
          if (profileToDelete?.isDefault) {
            return {
              error: 'Cannot delete the default profile.',
            }
          }

          // Remove the profile
          const newProfiles = state.profiles.filter((profile) => profile.id !== profileId)

          // If the deleted profile was active, switch to the first remaining profile
          let newActiveProfileId = state.activeProfileId
          if (state.activeProfileId === profileId && newProfiles.length > 0) {
            newActiveProfileId = newProfiles[0]?.id ?? newActiveProfileId
          }

          return {
            profiles: newProfiles,
            activeProfileId: newActiveProfileId,
            error: null,
          }
        })
        // Paid tier: queue a tombstone only if a real removal occurred.
        if (willRemove && target) {
          syncEntityDelete('userProfile', target)
        }
      },

      // Switch to a different profile
      switchProfile: (profileId: string) => {
        set((state) => {
          // Check if profile exists
          const profileExists = state.profiles.some((p) => p.id === profileId)

          if (!profileExists) {
            console.error(`[profileStore] Profile ${profileId} not found`)
            return { error: 'Profile not found.' }
          }

          // Clear any previous error on successful switch
          return {
            activeProfileId: profileId,
            error: null,
          }
        })
      },

      // Set loading state
      setLoading: (isLoading) => {
        set({ isLoading })
      },

      // Set error state
      setError: (error) => {
        set({ error })
      },

      // Reset store to initial state
      reset: () => {
        set({
          profiles: [DEFAULT_PROFILE],
          activeProfileId: DEFAULT_PROFILE.id,
          isLoading: false,
          error: null,
        })
      },
    }),
    {
      name: 'budget-planner-profiles-v1',
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      // v1 (Story 8-2): canonicalize any persisted profile currency so a
      // now-consolidated code (CAD/AUD/MXN) converges to its representative (USD).
      // Legacy blobs have no version (treated as 0), so this runs once on their
      // next load and rewrites storage. `-v1` in the store *name* is unrelated to
      // this numeric `version` (see currencyStore for the same distinction).
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Partial<Pick<ProfileState, 'profiles' | 'activeProfileId'>>
        if (!Array.isArray(state?.profiles)) return state
        return {
          ...state,
          profiles: state.profiles.map((profile) => ({
            ...profile,
            currency: canonicalizeCurrency(profile.currency || 'NONE'),
          })),
        }
      },
      partialize: (state) => ({
        profiles: state.profiles,
        activeProfileId: state.activeProfileId,
      }),
    }
  )
)

// Selector hooks for better performance
export const useProfiles = () => useProfileStore((state) => state.profiles)

export const useActiveProfileId = () => useProfileStore((state) => state.activeProfileId)

export const useActiveProfile = (): ClientProfile | null =>
  useProfileStore((state) => {
    if (state.activeProfileId === null) return null
    return state.profiles.find((p) => p.id === state.activeProfileId) ?? null
  })

export const useIsLoadingProfiles = () => useProfileStore((state) => state.isLoading)

export const useProfileError = () => useProfileStore((state) => state.error)

// Helper hooks
export const useProfileCount = () => useProfileStore((state) => state.profiles.length)

export const useHasMultipleProfiles = () => useProfileStore((state) => state.profiles.length > 1)

// Export types for use in components
export type { Profile as ProfileType, ClientProfile as ClientProfileType }
