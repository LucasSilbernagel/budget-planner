import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
	return <div className={cn('flex items-center justify-between', className)} {...props} />
}
