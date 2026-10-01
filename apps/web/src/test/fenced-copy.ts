/**
 * The "confident zero" fence, one table for both sides (story 84.4 review).
 *
 * `__tests__/served-pages.served.test.ts` asserts each gated page's SERVER
 * response does NOT contain these phrases (the skeleton must stand in for
 * store-derived content, story 38.2). `components/__tests__/loading-state.dom.test.tsx`
 * asserts the same page, resolved and EMPTY, really renders every one of them.
 * The second half is what keeps the first falsifiable: `not.toContain` passes
 * just as happily on copy the app never emits, so a phrase on only one side is
 * a fence guarding nothing. One constant, so the two tables cannot drift.
 *
 * ⚠️ Compared on DECODED text on the server side (`&#x27;` → `'`), with the
 * product's `$`/USD on, because the fence is `$0.00` with its symbol.
 */
export const FENCED_EMPTY_COPY = {
  '/': ['$0.00', "Let's set up your budget", '+ Add income'],
  '/income': ['$0.00', 'No income sources yet'],
  '/expenses': ['$0.00', 'No expenses recorded yet'],
  '/savings': ['$0.00', 'No savings goals recorded yet'],
  '/balance': ['$0.00', 'No balance entries recorded yet'],
} as const

export type GatedPath = keyof typeof FENCED_EMPTY_COPY
