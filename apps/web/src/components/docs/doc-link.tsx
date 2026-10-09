import type { AnchorHTMLAttributes } from 'react'
import { isExternalHref } from './is-external-href'

export function DocLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
	if (href && isExternalHref(href)) {
		return (
			<a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
				{children}
			</a>
		)
	}
	return (
		<a href={href} {...rest}>
			{children}
		</a>
	)
}
