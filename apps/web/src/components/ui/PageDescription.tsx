import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function PageDescription({ className, ...props }: ComponentProps<'p'>) {
	return <p className={cn('text-body mt-2', className)} {...props} />
}
