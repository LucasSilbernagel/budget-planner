import { canonicalizeCurrency } from '@budget-planner/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { cascadeProfileRowRemoval } from '../lib/profile-cascade'
import { sortProfilesOldestFirst } from '../lib/profile-order'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'

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

export interface ClientProfile {
	id: string
	userId: string
	name: string
	description?: string
	isDefault: boolean
	currency: string
	icon?: string | null
	createdAt?: string
	updatedAt?: string
}

export interface ProfileState {
	profiles: ClientProfile[]

	activeProfileId: string | null

	isLoading: boolean

	error: string | null

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

const generateUUID = (): string => {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID()
	}
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

const DEFAULT_PROFILE: ClientProfile = {
	id: generateUUID(),
	userId: '',
	name: 'Main Profile',
	description: 'Your primary financial profile',
	isDefault: true,
	currency: 'NONE',
}

export const useProfileStore = create<ProfileState>()(
	persist(
		(set, get) => ({
			profiles: [DEFAULT_PROFILE],
			activeProfileId: DEFAULT_PROFILE.id,
			isLoading: false,
			error: null,

			setProfiles: (profiles) => {
				set({
					profiles,
					activeProfileId: profiles[0]?.id ?? null,
					isLoading: false,
					error: null,
				})
			},

			setActiveProfileId: (profileId) => {
				set({ activeProfileId: profileId })
			},

			addProfile: (rawProfile) => {
				const profile = {
					...rawProfile,
					currency: canonicalizeCurrency(rawProfile.currency || 'NONE'),
				}
				const alreadyExists = get().profiles.some((p) => p.id === profile.id)
				set((state) => {
					const existingIndex = state.profiles.findIndex((p) => p.id === profile.id)

					if (existingIndex >= 0) {
						const updatedProfiles = [...state.profiles]
						updatedProfiles[existingIndex] = { ...updatedProfiles[existingIndex], ...profile }
						return { profiles: updatedProfiles }
					}

					return { profiles: [...state.profiles, profile] }
				})
				if (alreadyExists) {
					syncEntityUpdate('userProfile', profile)
				} else {
					syncEntityCreate('userProfile', profile)
				}
			},

			updateProfile: (profileId, rawUpdates) => {
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
				if (previous) {
					syncEntityUpdate('userProfile', { ...previous, ...updates }, previous)
				}
			},

			/**
			 * The only deletion path: the sync push enforces no default- or last-profile guard, so these
			 * guards decide. Deletion destroys the profile's rows (cascade).
			 */
			removeProfile: (profileId: string) => {
				const before = get()
				const target = before.profiles.find((p) => p.id === profileId)
				// No isDefault guard here: deleting the default locally without queueing a tombstone would
				// resurrect it on the next pull.
				const willRemove = before.profiles.length > 1 && target !== undefined

				// Oldest survivor, matching the server's default repair (createdAt ASC, then id); the store array
				// is not in age order.
				const survivors = before.profiles.filter((profile) => profile.id !== profileId)
				const oldestSurvivor = sortProfilesOldestFirst(survivors)[0]
				const nextActiveId =
					before.activeProfileId === profileId ? oldestSurvivor?.id : before.activeProfileId
				const promoted =
					willRemove && target?.isDefault
						? (survivors.find((profile) => profile.id === nextActiveId) ?? oldestSurvivor)
						: undefined

				set((state) => {
					if (state.profiles.length <= 1) {
						return {
							error: 'Cannot delete the last profile. Create a new profile first.',
						}
					}

					const newProfiles = state.profiles
						.filter((profile) => profile.id !== profileId)
						.map((profile) =>
							promoted && profile.id === promoted.id ? { ...profile, isDefault: true } : profile
						)

					let newActiveProfileId = state.activeProfileId
					if (state.activeProfileId === profileId && newProfiles.length > 0) {
						newActiveProfileId = sortProfilesOldestFirst(newProfiles)[0]?.id ?? newActiveProfileId
					}

					return {
						profiles: newProfiles,
						activeProfileId: newActiveProfileId,
						error: null,
					}
				})
				// Cascade runs after set() and only for a real removal. Local only: queued child deletes would
				// carry the active profileId and miss for a non-active profile.
				if (willRemove && target) {
					cascadeProfileRowRemoval(profileId)

					// Tombstone, then promote, so the promotion is the last word over the server's repair pick.
					syncEntityDelete('userProfile', target)
					if (promoted) {
						// Must be queued, not just set, or the server is left with zero defaults. dependsOn lets core
						// drop the promotion if the tombstone loses.
						const promotedRow: ClientProfile = { ...promoted, isDefault: true }
						syncEntityUpdate('userProfile', promotedRow, promoted, {
							dependsOn: { entityType: 'userProfile', entityId: target.id, type: 'delete' },
						})
					}
				}
			},

			switchProfile: (profileId: string) => {
				set((state) => {
					const profileExists = state.profiles.some((p) => p.id === profileId)

					if (!profileExists) {
						console.error(`[profileStore] Profile ${profileId} not found`)
						return { error: 'Profile not found.' }
					}

					return {
						activeProfileId: profileId,
						error: null,
					}
				})
			},

			setLoading: (isLoading) => {
				set({ isLoading })
			},

			setError: (error) => {
				set({ error })
			},

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
			skipHydration: true,
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
			// Persist after rehydrate so DEFAULT_PROFILE's module-load id is saved; otherwise every load mints
			// a new id and hides the user's rows. Skipped on error so an unreadable blob is not overwritten.
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

// Profiles read oldest-first, sorted here rather than in the store array. useShallow is
// load-bearing: the sort returns a new array each call (zustand v5 would loop without it).
export const useProfiles = () =>
	useProfileStore(useShallow((state) => sortProfilesOldestFirst(state.profiles)))

export const useActiveProfileId = () => useProfileStore((state) => state.activeProfileId)

export const useActiveProfile = (): ClientProfile | null =>
	useProfileStore((state) => {
		if (state.activeProfileId === null) return null
		return state.profiles.find((p) => p.id === state.activeProfileId) ?? null
	})

export const useIsLoadingProfiles = () => useProfileStore((state) => state.isLoading)

export const useProfileError = () => useProfileStore((state) => state.error)

export const useProfileCount = () => useProfileStore((state) => state.profiles.length)

export const useHasMultipleProfiles = () => useProfileStore((state) => state.profiles.length > 1)

export type { ClientProfile as ClientProfileType, Profile as ProfileType }
