import type React from 'react'

/**
 * Shared by the account menu and the nav's More trigger so the two adjacent disclosures look the same.
 * Decorative (`aria-hidden`); each trigger adds its own rotation mechanism.
 */
export const DISCLOSURE_CHEVRON_CLASS =
  'h-4 w-4 shrink-0 text-gray-500 transition-transform motion-reduce:transition-none dark:text-gray-400'

export function ChevronDownIcon({
  className,
  ...rest
}: { className: string } & Omit<React.SVGProps<SVGSVGElement>, 'className'>): React.ReactElement {
  // `rest` is spread first so no caller can override the fixed attributes, `aria-hidden` above all.
  return (
    <svg
      {...rest}
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}
