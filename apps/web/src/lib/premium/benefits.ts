/**
 * The canonical Premium benefit set — the single source of truth for WHICH
 * benefits Premium includes and in WHAT ORDER (FR56, story 33.2).
 *
 * ## Why this module exists
 *
 * Before story 33.2 the set was hard-coded four times — `pricing-page.tsx`,
 * `premium-prompt.tsx`, `HomePage.tsx` and `content/docs/features.md` — in four
 * different wordings, with no shared anything. Epic 30 then shipped three more
 * Premium capabilities and `features.md` was the only surface updated, so it
 * listed five while every other surface listed three and two source comments
 * asserted "exactly these three". A paying user could not discover features they
 * had already bought.
 *
 * This module fixes the *identity* of the set, not its wording. Each surface
 * keys its own copy off {@link PremiumBenefitId} via a `Record`, so **omitting a
 * benefit or inventing one is a `tsc` error** rather than something a test has to
 * notice. That is a stronger guarantee than any assertion, and it is why the
 * benefit strings deliberately do NOT live here.
 *
 * ## Why the wording is per-surface and not shared
 *
 * The differences are defended decisions, not drift:
 *   - `pricing-page.tsx` states the EU-storage claim on the sync line ONLY —
 *     repeating it reads as padding (a brand-1 review finding).
 *   - `premium-prompt.tsx` uses terse Title Case names because they sit in a
 *     scannable list beside a check glyph.
 *   - `HomePage.tsx` needs a title plus an explanatory sub-text per box.
 * Collapsing those into one string set would destroy all three. Sharing the
 * *set* is the actual fix for the drift FR56 describes.
 *
 * ## Why five entries and not six
 *
 * FR56 names three capabilities to add: exportable PDF/print summary reports
 * (FR53), user-defined categories, and the category breakdown analytics view
 * (FR54). The last two **share one route** (`/categories` hosts the manager and
 * the breakdown on the same page), so listing them separately would advertise
 * one destination as two features. They are one entry — `categories` — whose
 * copy must NAME the breakdown on every surface, which is the shape
 * `features.md` has already shipped since story 30-5.
 *
 * ## Amendment record
 *
 * This **amends** SCP 2026-07-18, which pinned the set to "exactly these three"
 * (multi-device sync, custom profiles, advanced forecasting), and the CONTENT-C /
 * CONTENT-G / CONTENT-J decisions that echoed it. The SCP's other rules survive
 * untouched: no "coming soon" padding, no dark mode (free since story 25-3), no
 * "no ads" (universal since 25-1), and no claim of a side-by-side comparison of
 * two saved forecasts.
 *
 * ## Order
 *
 * The tuple order IS the display order on every surface. `sync` leads because it
 * is the tier's headline benefit; the two Epic-30 additions are appended last so
 * that `categories` stays the final `features.md` bullet — `docs-content.test.ts`
 * finds "the categories bullet" by scanning forward to the next `- **` or `###`,
 * so inserting anything after it re-scopes that assertion.
 */
export const PREMIUM_BENEFIT_IDS = [
  'sync',
  'forecasting',
  'profiles',
  'report',
  'categories',
] as const

/**
 * One of the canonical Premium benefits.
 *
 * Every surface that explains Premium must supply copy for **exactly** these
 * keys — a `Record<PremiumBenefitId, …>` makes a missing key a compile error and
 * an invented key an excess-property error.
 */
export type PremiumBenefitId = (typeof PREMIUM_BENEFIT_IDS)[number]
