export interface ContactValidationError {
	field: 'message' | 'email'
	message: string
}

export interface ContactFormValues {
	name: string
	email: string
	message: string
}

export const MESSAGE_MIN_LENGTH = 10
export const MESSAGE_MAX_LENGTH = 2000

// Deliberately permissive: Formspark does the real validation.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateContactForm(values: ContactFormValues): ContactValidationError[] {
	const errors: ContactValidationError[] = []

	const message = values.message.trim()
	if (message.length === 0) {
		errors.push({ field: 'message', message: 'Please enter a message.' })
	} else if (message.length < MESSAGE_MIN_LENGTH) {
		errors.push({
			field: 'message',
			message: `Message must be at least ${MESSAGE_MIN_LENGTH} characters.`,
		})
	} else if (message.length > MESSAGE_MAX_LENGTH) {
		errors.push({
			field: 'message',
			message: `Message must be ${MESSAGE_MAX_LENGTH} characters or fewer.`,
		})
	}

	const email = values.email.trim()
	if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
		errors.push({ field: 'email', message: 'Please enter a valid email address.' })
	}

	return errors
}
