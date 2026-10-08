/** RFC 5321 maximum email length. */
const EMAIL_MAX_LENGTH = 254

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ASCII-only: one function produces the stored form and every lookup key, so they always agree.
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
	return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_REGEX.test(email)
}
