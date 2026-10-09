export function errorMessage(code: string | undefined): string | undefined {
	if (code === 'invalid_or_expired') {
		return 'That sign-in link was invalid or has expired. Please request a new one.'
	}
	return code ? 'Unable to sign you in. Please request a new link.' : undefined
}
