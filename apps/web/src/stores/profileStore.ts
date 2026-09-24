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
import { cascadeProfileRowRemoval } from '../lib/profile-cascade'
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
  // User-chosen avatar emoji (Story 54.2, FR78). Optional because it is nullable
  // in the database and unset for every profile until its owner picks one — in
  // which case the avatar falls back to the id hash (`resolveProfileIcon`).
  //
  // ⚠️ NO persist-version bump for this field, and that is deliberate: adding an
  // OPTIONAL property needs no migration, because an older persisted record
  // simply lacks the key and reads as `undefined`. Bumping `version` below would
  // re-run the currency-canonicalizing `migrate` for no reason.
  icon?: string | null
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

      /**
       * Remove a profile.
       *
       * ⚠️⚠️ THIS IS THE REAL DELETION PATH, not `server/functions/profiles.ts`.
       * That module's `deleteProfile` has ZERO production callers (story 63.2
       * measured it by grepping the IMPORT, not the identifier); a user's click
       * travels `profile-list.tsx` -> `useProfileManager().deleteProfile` -> here
       * -> `syncEntityDelete` -> the sync push, whose handler enforces no
       * default- or last-profile guard at all. So the guards below are the ones
       * that actually decide what a user can delete.
       *
       * ⚠️ Story 63.2 (FR97) lifted the DEFAULT guard and kept the LAST-profile
       * guard. Deleting the `isDefault` profile now promotes a survivor in the
       * same operation, because migration 0017's partial unique index
       * (`(userId) WHERE isDefault AND NOT isDeleted`) permits zero defaults and
       * every consumer resolving one does it as `find(p => p.isDefault) ?? [0]`
       * — a fallback that yields the WRONG profile rather than an error.
       *
       * ⚠️ Story 66.3 (FR104) made the deletion DESTRUCTIVE. The profile's
       * income, expenses, savings goals, balance entries and categories are
       * removed locally by `cascadeProfileRowRemoval` below, and the server
       * destroys the same rows as one consequence of the `userProfile` delete
       * (`server/api/sync.ts:deleteProfileWithChildren`). Before 66.3 those rows
       * stayed live on every device, merely unreachable.
       *
       * ⚠️ The refusal below is no longer silent: `useProfileError` is rendered
       * by `components/profiles/profile-list.tsx` as of story 66.3 (AC-7). The
       * UI's job is still to not OFFER a deletion this will refuse.
       */
      removeProfile: (profileId: string) => {
        // Decide up front whether this removal will actually happen, so we only
        // queue a server tombstone for a real delete (the last-profile guard
        // below still rejects some calls).
        const before = get()
        const target = before.profiles.find((p) => p.id === profileId)
        // ⚠️ The `!target.isDefault` clause that used to sit here is GONE (63.2).
        // Leaving it while the `set()` below removed the row would delete the
        // default LOCALLY while queueing no tombstone — the profile returns on
        // the next pull, on every device, with the local list looking correct.
        const willRemove = before.profiles.length > 1 && target !== undefined

        // The survivor that inherits `isDefault`, computed ONCE so the store
        // write and the queued update cannot disagree. It is the profile that is
        // active AFTER the deletion: the current one if it survives, otherwise
        // the first survivor — the same choice the `set()` below makes for
        // `activeProfileId`.
        //
        // ⚠️ They agree on every reachable input but are NOT the same expression,
        // and an earlier comment here overclaimed that (code review). If
        // `activeProfileId` names no profile at all — a corrupt or stale
        // persisted blob — `survivors.find` misses and the promotion falls back
        // to `survivors[0]` while `activeProfileId` stays stale, so the promoted
        // profile is not the active one. That is the pre-existing orphaned-id
        // case (story 63.1 AC-7), not something this story introduces.
        const survivors = before.profiles.filter((profile) => profile.id !== profileId)
        const nextActiveId =
          before.activeProfileId === profileId ? survivors[0]?.id : before.activeProfileId
        const promoted =
          willRemove && target?.isDefault
            ? survivors.find((profile) => profile.id === nextActiveId) ?? survivors[0]
            : undefined

        set((state) => {
          // Prevent deletion of the last profile (UNCHANGED by 63.2)
          if (state.profiles.length <= 1) {
            return {
              error: 'Cannot delete the last profile. Create a new profile first.',
            }
          }

          // Remove the profile, promoting the survivor when the default went.
          const newProfiles = state.profiles
            .filter((profile) => profile.id !== profileId)
            .map((profile) =>
              promoted && profile.id === promoted.id ? { ...profile, isDefault: true } : profile
            )

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
        // ⚠️⚠️ DESTROY the deleted profile's rows (story 66.3, D1/AC-1). Runs only
        // for a real removal, so the last-profile refusal above leaves every row
        // in place — a refused deletion must not destroy anything.
        //
        // ⚠️ AFTER the `set()`, not before: the cascade reads five OTHER stores
        // and this store's write is what makes the deletion real. Ordering them
        // the other way would leave the rows gone and the profile present if the
        // guard above rejected the call.
        //
        // ⚠️ LOCAL ONLY — it queues nothing. See `lib/profile-cascade.ts` for why
        // routing child deletes through `syncEntityDelete` is broken by
        // construction for the common case (deleting a NON-active profile).
        //
        // Merged with the paid-tier queue below into ONE `willRemove` block so the
        // two can never disagree about whether a deletion happened.
        if (willRemove && target) {
          cascadeProfileRowRemoval(profileId)

          // Paid tier: queue the profile tombstone. A no-op on the free tier
          // (`syncEntityDelete` returns early with no bridge registered), so the
          // cascade above is the whole deletion there.
          // ⚠️⚠️ ORDER IS A DATABASE CONSTRAINT, not a preference. The index
          // covers LIVE rows only, so promoting before the old default is
          // tombstoned leaves two rows satisfying `isDefault AND NOT isDeleted`
          // and the push fails on a unique violation. Tombstone, then promote —
          // and the push applies a batch's operations in array order (the
          // apply loop in `server/api/sync.ts:processBatchSync`), so queue
          // order is apply order.
          // ⚠️ Since the code review the server also REPAIRS the invariant
          // after any batch touching `userProfile`, so a reordering that
          // rejects the promotion degrades to "a default was chosen for
          // you" rather than to an account with none.
          syncEntityDelete('userProfile', target)
          if (promoted) {
            // ⚠️ Queued, not merely written above. A `set()` marks the flag
            // locally and tells the server nothing, leaving the account with
            // ZERO defaults server-side — invisible until another device pulls.
            //
            // ⚠️ Typed as `ClientProfile`, not inlined: `syncEntityUpdate` takes
            // `ClientEntity` (`{ id, updatedAt? }`), so an object literal at the
            // call site trips TS's excess-property check on `isDefault`.
            const promotedRow: ClientProfile = { ...promoted, isDefault: true }
            syncEntityUpdate('userProfile', promotedRow, promoted)
          }
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
      // Code review of story 54.4 (HIGH): persist once after every successful
      // rehydrate, so the default profile's id is SAVED on a fresh browser.
      //
      // ⚠️ WHY. `DEFAULT_PROFILE.id` is minted at MODULE LOAD, and a free user
      // never writes this store. zustand 4.5.7's `rehydrate()` of an empty key
      // writes nothing back, so every page load produced a NEW default id — and
      // since 54.4 every new row is stamped with the active profile and reads are
      // scoped by it, a free user's rows vanished on the next reload. Writing the
      // (possibly just-defaulted) state here makes the id stable from the first
      // load on. For an already-saved blob this rewrites identical content.
      //
      // Skipped when rehydration failed (corrupt JSON, blocked storage): the store
      // then sits at its defaults, and overwriting the unreadable blob would turn a
      // recoverable read error into a permanent loss. A blocked-storage write is
      // swallowed for the same reason the hydrate is (see lib/store-hydration).
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          return
        }
        try {
          useProfileStore.setState({})
        } catch (writeError) {
          console.error('[profileStore] could not persist the active profile:', writeError)
        }
      },
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
