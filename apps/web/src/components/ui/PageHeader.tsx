import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function PageHeader({ className, ...props }: ComponentProps<'header'>) {
	return <header className={cn('mb-8', className)} {...props} />
}
