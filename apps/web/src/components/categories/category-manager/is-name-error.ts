import type { CategoryValidationError } from '../../../hooks/useCategoryManager'

// not-found means the category was deleted elsewhere, which is not a name problem, so focus stays put.
export function isNameError(error: CategoryValidationError): boolean {
	return error.reason === 'empty' || error.reason === 'too-long' || error.reason === 'duplicate'
}
