import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

/**
 * A table's horizontal scroll region: a named landmark that is a Tab stop ONLY
 * while it actually scrolls (story 93.1, FR149).
 *
 * ## The rule
 *
 * - `role="region"` and `aria-label` are ALWAYS rendered (93.1 D2): a region
 *   named for its table is a meaningful landmark whether or not it scrolls, and
 *   its name must not come and go with the window width.
 * - `tabindex="0"` only while the content is wider than the box
 *   (`scrollWidth > clientWidth`). A scrolling region must be a focus stop
 *   (WCAG 2.1.1): arrow keys on the focused region are the only pointer-free
 *   way to SEE the columns past the edge that hold no focusable control (the
 *   amounts). Tab into a row's Edit/Delete buttons scrolls them into view on
 *   its own (MEASURED in Chromium, 93.1 review), so it is the figures, not the
 *   Actions column, that need the stop.
 *   A region that fits has nothing to scroll, so as a Tab stop it only costs a
 *   keystroke: at ≥ 768 px no seeded table scrolls, which left `/report` with 6
 *   dead stops and each finance page with 1 (91.2 review).
 *
 * This REVERSES story 42.2's choice to make the focus stop unconditional
 * ("making them conditional would need a measurement this layer deliberately
 * does not take"). This component is that measurement, taken on purpose: fit
 * depends on the font (on CI's DejaVu the free `/income` table is 656 px in a
 * 656 px wrapper, `ResponsiveTable.tsx`), so only the browser can say.
 *
 * ## Server render and first client render: `tabindex="0"`
 *
 * The server cannot measure, and a region that scrolls must stay reachable
 * without JavaScript, so the safe default is "focusable". The first client
 * render emits the SAME markup (state starts `true`; nothing reads `window`
 * during render), so hydration sees no attribute diff. The measurement runs in
 * an effect after mount and drops the attribute if the content fits.
 *
 * ## When it re-measures
 *
 * - after EVERY render of this component (cheap: two layout reads, and a
 *   `setState` that bails out when the answer is unchanged). Rows added,
 *   removed or edited re-render the page, which re-renders this.
 * - on a `ResizeObserver` watching the region (viewport resize changes its
 *   box) AND its first element child (the table: font load or a row edit
 *   changes ITS width while the region's box may not change at all).
 *
 * ⚠️ Known edge, accepted: if the region has focus and the window widens until
 * the table fits, the attribute goes away while focus stays on the element
 * until the user moves on. Tab then continues normally.
 *
 * ⚠️ No `biome-ignore` here, deliberately (MEASURED 93.1: Biome 1.5.3's
 * `lint/a11y/noNoninteractiveTabindex` does not flag a non-literal `tabIndex`,
 * and an unused suppression is itself a warning). The five hand-written
 * regions this replaced each carried one, because on a LITERAL `tabIndex={0}`
 * the rule's AUTOFIX deletes the attribute and with it the only keyboard route
 * to a scrolling table's hidden columns. If this ever goes back to a literal,
 * suppress the rule; never accept its fix.
 */
export function TableScrollRegion({
  label,
  className,
  children,
}: {
  /** The region's accessible name. Tests and e2e find regions by it. */
  label: string
  className: string
  children: ReactNode
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const scrolls = useHorizontalOverflow(ref)
  return (
    <div
      ref={ref}
      className={className}
      tabIndex={scrolls ? 0 : undefined}
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  )
}

/**
 * `true` while `ref`'s element is wider inside than its box. Starts `true` so
 * the server render and the first client render agree (see
 * {@link TableScrollRegion}).
 */
function useHorizontalOverflow(ref: RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = useState(true)
  const observerRef = useRef<ResizeObserver | null>(null)
  const observedChildRef = useRef<Element | null>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setOverflows(el.scrollWidth > el.clientWidth)
  }, [ref])

  // Create the observer once; watch the region itself.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    observerRef.current = observer
    return () => {
      observer.disconnect()
      observerRef.current = null
      observedChildRef.current = null
    }
  }, [ref, measure])

  // After every render: measure, and keep the observer on the CURRENT first
  // child (a re-render can replace the table element).
  useEffect(() => {
    const el = ref.current
    const observer = observerRef.current
    const child = el?.firstElementChild ?? null
    if (observer && child !== observedChildRef.current) {
      if (observedChildRef.current) observer.unobserve(observedChildRef.current)
      if (child) observer.observe(child)
      observedChildRef.current = child
    }
    measure()
  })

  return overflows
}
