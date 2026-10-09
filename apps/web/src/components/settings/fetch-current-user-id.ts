export async function fetchCurrentUserId(): Promise<string | undefined> {
	try {
		const response = await fetch('/api/auth/me')
		if (!response.ok) {
			return undefined
		}
		const data = (await response.json()) as { user?: { userId?: string } | null }
		return data.user?.userId ?? undefined
	} catch {
		return undefined
	}
}
