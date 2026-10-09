import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

const VARIANT_CLASS = {
	primary:
		'px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors',
	secondary:
		'px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700',
} as const

// `type` is required: a defaulted `submit` inside a form is the classic accidental-submit bug.
type ButtonProps = ComponentProps<'button'> & {
	type: 'button' | 'submit' | 'reset'
	variant?: keyof typeof VARIANT_CLASS
}

export function Button({ variant = 'primary', className, type, ...props }: ButtonProps) {
	return <button type={type} className={cn(VARIANT_CLASS[variant], className)} {...props} />
}
