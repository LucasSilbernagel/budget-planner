import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function PageContent({ className, ...props }: ComponentProps<'div'>) {
	return <div className={cn('mx-auto max-w-4xl', className)} {...props} />
}
