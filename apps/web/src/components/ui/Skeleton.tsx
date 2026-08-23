/**
 * The app's one skeleton contract (story 38.2, UX-DR43).
 *
 * Before this file the same idea existed in three places and nowhere shared:
 *
 *   1. `premium/PremiumFeatureGate.tsx` — `aria-hidden` + `animate-pulse`
 *      WRAPPING the resolved children, so the footprint matches by construction.
 *   2. `categories/CategoryPicker.tsx`  — `aria-hidden` + a fixed-height bar.
 *   3. `categories/CategoriesPage.tsx`  — a full-screen `role="status"` SPINNER.
 *
 * ⚠️ The epic named only the first two. The third is a different affordance —
 * announced, centred, whole-page — and it deliberately does NOT adopt this
 * primitive: swapping a spinner for a skeleton there would change that page's
 * behaviour, which is outside story 38.2. Shapes 1 and 2 are this file's two
 * exports; there is no third convention.
 *
 * ## The contract every skeleton here honours
 *
 * - **Identical on the server and on the first client render.** Nothing here
 *   reads a store, a media query or `navigator`, so it cannot diverge.
 * - **`aria-hidden`.** A pulsing grey box is not information. The announcement
 *   is made once per page by {@link LoadingStatus}, not once per skeleton.
 * - **The resolved element's footprint.** Callers size the placeholder; this
 *   file never guesses. {@link SkeletonBlock} takes the footprint from the real
 *   children, {@link Skeleton} takes it from `className`.
 * - **`motion-safe:` on every animation.** See {@link PULSE} — the pending state
 *   can last indefinitely, so the pulse is opt-out-able by anyone who has asked
 *   their OS for less motion.
 *
 * ## ⚠️ Sizing a text figure
 *
 * For a money figure, keep the resolved `<p>` and its classes and swap only its
 * CONTENT for a {@link PendingFigure}. The line box is driven by the `<p>`'s own
 * font-size and line-height, so an inline-block of height `1em` sits inside the
 * strut the text would have made — no pixel constant, nothing to keep in sync.
 * See {@link PendingFigure} for the limits of that claim, which are narrower than
 * they first look.
 */

import type React from 'react'

/**
 * ⚠️ `motion-safe:`, not a bare `animate-pulse` — and this is not decoration.
 *
 * The pending state normally lasts about one frame, but for a visitor whose
 * JavaScript never runs it lasts **forever**, because the gate that resolves it
 * is a mount effect. An indefinite animation is exactly what WCAG 2.2.2 (Pause,
 * Stop, Hide) is about once it passes five seconds. `motion-safe:` means anyone
 * who has asked their OS for reduced motion gets a static placeholder instead of
 * a permanently pulsing page. Raised in code review.
 *
 * The two pre-existing call sites inherit this when they adopt the primitive,
 * which is a small improvement to them rather than a change in what they do.
 */
const PULSE = 'motion-safe:animate-pulse'

export interface SkeletonProps {
  /**
   * Footprint + shape. The caller owns the size; this component never guesses.
   *
   * ⚠️ REQUIRED, deliberately. An earlier version defaulted it, which let a
   * caller mint a skeleton with no width and no height — an invisible element
   * that satisfies every "is the skeleton present?" assertion while reserving no
   * space at all. Raised in code review.
   */
  className: string
  /** Optional `data-testid`, by convention `<resolved-testid>-skeleton`. */
  testId?: string
}

/**
 * A standalone placeholder. Renders a `<span>` so it is legal inside a `<p>`,
 * a `<td>` or any other text-level context.
 */
export function Skeleton({ className, testId }: SkeletonProps): React.ReactElement {
  return <span aria-hidden="true" data-testid={testId} className={`${PULSE} ${className}`} />
}

/**
 * The default grey bar: rounded, theme-aware, no size.
 *
 * ⚠️ Deliberately NOT baked into {@link Skeleton}. `CategoryPicker`'s bar paints
 * `surface-inset`, and Tailwind conflicts resolve by CSS SOURCE ORDER rather
 * than by the order classes appear in a `className` string (the story-21
 * lesson) — so a background hard-coded in the primitive could silently win or
 * lose against a caller's own surface. Callers that want the grey opt in.
 */
export const SKELETON_BAR = 'rounded bg-gray-200 dark:bg-gray-700'

export interface PendingFigureProps {
  /**
   * By convention the resolved element's testid plus `-skeleton`. Optional so a
   * multi-bar placeholder can label its FIRST bar and leave the rest anonymous —
   * several testids for one logical placeholder would break the count
   * assertions.
   */
  testId?: string
  /** Bar width. The HEIGHT is never passed — see below. */
  widthClass?: string
}

/**
 * The placeholder for a money figure.
 *
 * Drop it in place of the formatted amount and leave the surrounding `<p>`, its
 * testid and its type classes exactly as they are:
 *
 * ```tsx
 * <p data-testid="overview-net-worth" className="text-2xl font-bold text-purple-600">
 *   {hydrated ? formatAmount(netWorth) : <PendingFigure testId="overview-net-worth-skeleton" />}
 * </p>
 * ```
 *
 * The height is `h-[1em]`, never a pixel constant: the `<p>`'s line box is
 * decided by its own font-size and line-height, so a `1em` inline-block sits
 * inside the strut the text would have made.
 *
 * ⚠️ **That is a claim about font METRICS, not a law**, and an earlier version of
 * this docblock overstated it as true "under any font … needs no measurement".
 * A reviewer computed the margin: with `align-middle` the bar clears the strut's
 * descender comfortably at `text-sm` / `text-lg` / `text-2xl` under both Noto
 * Sans (dev) and DejaVu Sans (CI), but at **`text-3xl` under DejaVu the clearance
 * is 0.4px** — and `/savings` renders its headline figure at exactly `text-3xl`.
 * A font with a shallower descent or a larger x-height flips it and the bar
 * starts growing the line box. If a new font is ever adopted, re-measure rather
 * than trusting this paragraph.
 *
 * ⚠️ **Inside a flex container this technique does not apply at all.** An
 * `inline-flex … items-center` has no strut — the flex item's height IS the
 * content height — so `h-[1em]` comes up short of the text's line box by
 * (line-height − font-size). Use the container's line-height there (`h-6` for
 * `text-base`), which Tailwind sets in `rem` and is therefore genuinely
 * font-independent. Measured: 34px vs 42px on the Overview's onboarding buttons.
 *
 * The width does not affect the footprint: the `<p>` is a block, so its own
 * width is unchanged. `widthClass` only decides how long the grey bar looks.
 */
export function PendingFigure({
  testId,
  widthClass = 'w-28',
}: PendingFigureProps): React.ReactElement {
  return (
    <Skeleton
      testId={testId}
      className={`${SKELETON_BAR} inline-block h-[1em] align-middle ${widthClass}`}
    />
  )
}

export interface SkeletonBlockProps {
  /** Footprint + shape for the wrapper. Optional here: `children` carry it. */
  className?: string
  /** Optional `data-testid`, by convention `<resolved-testid>-skeleton`. */
  testId?: string
  /**
   * Real content, rendered pulsing and `aria-hidden`. Use when the resolved
   * markup is available at pending time — the footprint then matches exactly,
   * with no measurement and nothing to keep in sync.
   */
  children?: React.ReactNode
}

/**
 * A block-level pulsing wrapper. This is `PremiumFeatureGate`'s original shape,
 * lifted verbatim: the pending state renders the resolved content itself, so the
 * layout cannot shift when it resolves.
 */
export function SkeletonBlock({
  className,
  testId,
  children,
}: SkeletonBlockProps): React.ReactElement {
  return (
    <div aria-hidden="true" data-testid={testId} className={`${PULSE} ${className ?? ''}`.trim()}>
      {children}
    </div>
  )
}

/**
 * The single announced region for a page whose figures are still loading.
 *
 * ⚠️ ONE per page, never one per skeleton. `deferred-work.md` already records
 * the failure this exists to prevent: a page whose only pending content is
 * `aria-hidden` gives a screen reader a heading followed by nothing. It also
 * records the opposite failure — N live regions announcing N times.
 *
 * ⚠️ The message is TEXT CONTENT, not an `aria-label` on an empty element. The
 * first version was an empty `<div role="status" aria-label="…">`, and a
 * reviewer pointed out that a live region announces content *changes* — an empty
 * region present at first paint and then removed is silent in most
 * screen-reader/browser pairs, so the announcement the comment promised never
 * happened. Real text at least gives a linear reader something to find, and gives
 * the region something to announce wherever it is inserted after load.
 *
 * `sr-only`: the visible signal is the skeletons themselves.
 *
 * ⚠️ There is a second, unrelated `role="status"` on every page — the nav's
 * persistent "Account status" strip (`auth/auth-indicator.tsx`). Two regions with
 * distinct accessible names is fine; a third per skeleton is what the count
 * assertion in `loading-state.dom.test.tsx` exists to prevent.
 */
export function LoadingStatus(): React.ReactElement {
  return (
    <div role="status" data-testid="page-loading-status" className="sr-only">
      Loading your figures
    </div>
  )
}

export interface EmptyStateSkeletonProps {
  testId: string
  /**
   * How many text lines the resolved empty card has. The four CRUD list sections
   * render two (a base-size line and a `text-sm` line); the two chart sections
   * render one. Defaults to 2.
   */
  lines?: 1 | 2
}

/**
 * The placeholder for a section's empty state.
 *
 * The list sections and the chart sections all render the same card —
 * `surface-inset rounded-lg p-8 text-center` — so this mirrors that box model
 * once. Each bar is `h-[1em]` at the matching type size, which makes the pending
 * footprint identical to the resolved-EMPTY one with nothing measured and no
 * pixel constant to go stale.
 *
 * ⚠️ It matches the EMPTY state, not the populated one: a table's height depends
 * on its row count and a chart's on its data, and no placeholder can match that.
 * Story 38.2 records the residual shift for the populated case rather than
 * claiming zero.
 */
export function EmptyStateSkeleton({
  testId,
  lines = 2,
}: EmptyStateSkeletonProps): React.ReactElement {
  return (
    <SkeletonBlock className="surface-inset rounded-lg p-8 text-center" testId={testId}>
      <p className={lines === 2 ? 'mb-4' : undefined}>
        <span className={`${SKELETON_BAR} inline-block h-[1em] w-48 max-w-full align-middle`} />
      </p>
      {lines === 2 && (
        <p className="text-sm">
          <span className={`${SKELETON_BAR} inline-block h-[1em] w-64 max-w-full align-middle`} />
        </p>
      )}
    </SkeletonBlock>
  )
}
