/**
 * Pure client-side validation for the in-app contact form (story 9-1, AC-2).
 *
 * Mirrors the app's established inline field-level error pattern (see
 * {@link AddSavingsGoalForm} / `validateSavingsGoal`): a pure function that
 * takes the raw field values and returns an array of `{ field, message }`
 * errors (empty when valid), so the component can drive `aria-invalid`,
 * `aria-describedby`, and `role="alert"` output without any `alert()` popups
 * (forbidden app-wide since story 6-8).
 *
 * Per the epic, only `message` is required; `name` and `email` are optional.
 * When an email IS supplied it must look like a valid address.
 */

export interface ContactValidationError {
  field: 'message' | 'email'
  message: string
}

export interface ContactFormValues {
  name: string
  email: string
  message: string
}

/** Minimum meaningful message length (matches the word-game-db-v2 reference). */
export const MESSAGE_MIN_LENGTH = 10
/** Upper bound so a single submission can't be arbitrarily large. */
export const MESSAGE_MAX_LENGTH = 2000

/**
 * Permissive email shape check: non-empty local part, an `@`, a domain with a
 * dot, and no whitespace. Deliberately not RFC-exhaustive — it only guards
 * against obviously malformed input, since delivery/validation ultimately
 * happens on Formspark's side.
 */
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

  // Email is optional; only validate a shape when one was actually entered.
  const email = values.email.trim()
  if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
    errors.push({ field: 'email', message: 'Please enter a valid email address.' })
  }

  return errors
}
