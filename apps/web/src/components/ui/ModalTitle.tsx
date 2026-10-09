import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

type ModalTitleProps = ComponentProps<'h3'> & { id: string; as?: 'h2' | 'h3' }

export function ModalTitle({ as: Tag = 'h3', className, ...props }: ModalTitleProps) {
	return <Tag className={cn('text-lg font-medium text-heading', className)} {...props} />
}
