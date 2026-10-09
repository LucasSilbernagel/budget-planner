import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

const VARIANT_CLASS = {
	raised: 'surface rounded-lg shadow-md p-6',
	inset: 'surface-inset rounded-lg',
} as const

type CardProps = ComponentProps<'div'> & {
	variant?: keyof typeof VARIANT_CLASS
	as?: 'div' | 'section' | 'article'
}

export function Card({ variant = 'raised', as: Tag = 'div', className, ...props }: CardProps) {
	return <Tag className={cn(VARIANT_CLASS[variant], className)} {...props} />
}
