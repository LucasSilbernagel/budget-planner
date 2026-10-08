import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { logoutUser } from '@/server/api/auth/paddle'
import { buildClearSessionCookies, isProductionEnv } from '@/server/api/auth/session-cookies'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
	const result = await logoutUser(request)

	// Cleared unconditionally, decoupled from the revocation write, so a DB error cannot leave
	// the user signed in.
	const [clearCookie, clearHasSessionCookie] = buildClearSessionCookies(isProductionEnv())

	const response = result.success
		? json({ success: true })
		: json({ success: false, error: result.error }, { status: 500 })
	response.headers.append('Set-Cookie', clearCookie)
	response.headers.append('Set-Cookie', clearHasSessionCookie)

	return response
}

export const Route = createFileRoute('/api/auth/logout')({
	server: {
		handlers: {
			POST,
		},
	},
})
