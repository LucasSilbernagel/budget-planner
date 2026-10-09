import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

type FormLabelProps = ComponentProps<'label'> & { htmlFor: string }

export function FormLabel({ className, ...props }: FormLabelProps) {
	// biome-ignore lint/a11y/noLabelWithoutControl: callers always pass htmlFor
	return <label className={cn('block text-sm font-medium text-label mb-1', className)} {...props} />
}
