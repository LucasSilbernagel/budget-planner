import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function ModalHeader({ className, ...props }: ComponentProps<'div'>) {
	return <div className={cn('flex justify-between items-center mb-6', className)} {...props} />
}
