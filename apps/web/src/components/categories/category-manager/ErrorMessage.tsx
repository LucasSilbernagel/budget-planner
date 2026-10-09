import type { ReactElement } from 'react'
import { FormError } from '@/components/ui/FormError'
import type { CategoryValidationError } from '../../../hooks/useCategoryManager'

export function ErrorMessage({
	error,
	id,
}: {
	error: CategoryValidationError
	id: string
}): ReactElement {
	return (
		<FormError id={id} data-testid={`category-error-${error.reason}`}>
			{error.message}
		</FormError>
	)
}
