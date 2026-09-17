/**
 * The retired light-only Tailwind colour tokens, shared by every profiles-area
 * theming sweep (story 54.5, UX-DR59).
 *
 * ⚠️ WHY THIS IS A MODULE AND NOT A CONST IN EACH TEST FILE. The legal and docs
 * sweeps keep their lists in sync by hand under a comment that says "any addition
 * here must be made in all four sweeps" — and `legal-page-view.test.tsx:51-55`
 * records a code review finding where that promise failed: one list had silently
 * omitted `text-gray-700` and `border-gray-200` that its sibling carried, so a
 * page could reacquire either and stay green. Story 54.5 first reproduced that
 * exact setup across its two sweeps; its own code review called it out. A shared
 * import is the mechanism the comment was standing in for.
 *
 * ⚠️ WHAT THIS LIST DOES NOT CATCH. Membership is matched against whole class
 * tokens, so a VARIANT-prefixed light value (`hover:bg-gray-50`,
 * `md:text-gray-500`, `group-hover:text-gray-900`) does not match and is NOT
 * swept. That is deliberate — variant-prefixed light values are legitimate when
 * paired with a `dark:` twin — but it means the sweep alone cannot prove a
 * `dark:hover:` counterpart still exists. Those pairs must be pinned by explicit
 * assertions; see `assertDarkPairedHovers`.
 */
export const RETIRED_LIGHT_ONLY_TOKENS = [
  'bg-white',
  'bg-gray-50',
  'bg-gray-100',
  'text-gray-900',
  'text-gray-800',
  'text-gray-700',
  'text-gray-600',
  'text-gray-500',
  // Added by 54.5's code review: `pricing-page.test.tsx` already carries this one
  // and the profiles lists did not, which is the drift this module exists to stop.
  'text-gray-400',
  'text-blue-600',
  'text-blue-700',
  // Retired by 54.5 itself — the active indicator moved to green-700 because
  // green-600 on white measures 3.30:1. Listed so it cannot return on any OTHER
  // element and pass, which the single element-scoped assertion would not catch.
  'text-green-600',
  'border-gray-200',
  'border-gray-100',
  'border-gray-300',
] as const

/**
 * Collect every class token in a rendered subtree, root included.
 *
 * Returned as an array rather than a Set so the caller can assert it is NON-EMPTY
 * before sweeping it — an absence loop over an empty array passes every assertion
 * for free, which is precisely the silent green this suite is built to avoid.
 */
export function collectClassTokens(root: HTMLElement): string[] {
  return [root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList])
}

/**
 * Assert no retired light-only token survives anywhere in `root`.
 *
 * Takes `expect` from the caller so this file stays a plain helper module rather
 * than importing a test runner into non-test code.
 */
export function assertNoRetiredTokens(
  expect: (actual: unknown, message?: string) => { not: { toContain: (v: unknown) => void } },
  classes: string[]
): void {
  for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
    expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
  }
}
