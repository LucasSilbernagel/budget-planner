import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

type CardTitleProps = ComponentProps<'h2'> & { as?: 'h2' | 'h3' }

export function CardTitle({ as: Tag = 'h2', className, ...props }: CardTitleProps) {
	return <Tag className={cn('text-lg font-semibold text-subheading', className)} {...props} />
}
