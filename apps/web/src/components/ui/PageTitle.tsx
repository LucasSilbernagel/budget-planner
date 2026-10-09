import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function PageTitle({ className, ...props }: ComponentProps<'h1'>) {
	return <h1 className={cn('text-3xl font-bold text-heading', className)} {...props} />
}
