import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function ModalFooter({ className, ...props }: ComponentProps<'div'>) {
	return <div className={cn('flex justify-end gap-3 pt-4', className)} {...props} />
}
