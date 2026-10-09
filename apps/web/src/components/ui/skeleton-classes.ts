/** `motion-safe:`: without JS the pending state lasts forever, and an endless pulse fails WCAG 2.2.2. */
export const PULSE = 'motion-safe:animate-pulse'

/** Not baked into `Skeleton`: Tailwind resolves conflicting backgrounds by source order, not class order. */
export const SKELETON_BAR = 'rounded bg-gray-200 dark:bg-gray-700'
