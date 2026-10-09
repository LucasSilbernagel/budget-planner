import {
	type ClientProfile,
	useActiveProfile as useActiveProfileBase,
	useActiveProfileId,
	useProfileStore,
	useProfiles,
} from '../stores/profileStore'

export function useActiveProfile(): ClientProfile | null {
	return useActiveProfileBase()
}

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

export function useProfileSwitcher() {
	const { switchProfile, activeProfileId } = useProfileStore()

	const switchToProfile = (profileId: string) => {
		const state = useProfileStore.getState()
		const profileExists = state.profiles.some((p) => p.id === profileId)

		if (!profileExists) {
			console.error(`[useActiveProfile] Profile ${profileId} not found`)
			return
		}

		switchProfile(profileId)
	}

	const switchToNextProfile = () => {
		const state = useProfileStore.getState()
		const profiles = state.profiles
		if (profiles.length <= 1) return

		const currentIndex = profiles.findIndex((p) => p.id === activeProfileId)
		const nextIndex = (currentIndex + 1) % profiles.length
		// `noUncheckedIndexedAccess` cannot prove the modulo indexes a real element.
		const next = profiles[nextIndex]
		if (next) switchProfile(next.id)
	}

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

export function useProfileManager() {
	const { addProfile, updateProfile, removeProfile, setProfiles, setLoading, setError } =
		useProfileStore()

	const createProfile = (
		profileData: Omit<ClientProfile, 'id' | 'userId'> & { userId: string }
	) => {
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

		const newProfile = {
			...profileData,
			id: generateUUID(),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		} satisfies ClientProfile

		addProfile(newProfile)
		return newProfile
	}

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

	const deleteProfile = (profileId: string) => {
		return removeProfile(profileId)
	}

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

export function useProfileById(profileId: string | null): ClientProfile | null {
	const profiles = useProfiles()

	if (profileId === null) return null

	return profiles.find((p) => p.id === profileId) ?? null
}

export function useIsProfileActive(profileId: string): boolean {
	const activeProfileId = useActiveProfileId()
	return activeProfileId === profileId
}

export function useDefaultProfile(): ClientProfile | null {
	const profiles = useProfiles()
	return profiles.find((p) => p.isDefault) ?? null
}
