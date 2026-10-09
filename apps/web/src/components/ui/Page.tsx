import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

type PageProps = ComponentProps<'div'> & { as?: 'div' | 'main' }

export function Page({ as: Tag = 'div', className, ...props }: PageProps) {
	return <Tag className={cn('min-h-screen surface-sunken p-4 sm:p-8', className)} {...props} />
}
