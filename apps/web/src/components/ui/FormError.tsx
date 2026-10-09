import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

type FormErrorProps = ComponentProps<'p'> & { id: string }

export function FormError({ className, ...props }: FormErrorProps) {
	return (
		<p
			role="alert"
			className={cn('mt-1 text-sm text-red-600 dark:text-red-400', className)}
			{...props}
		/>
	)
}
