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
 * A Tab stop only while it scrolls: arrow keys are the only pointer-free way to see overflowed figures.
 * Starts focusable so SSR and the first client render agree; an effect drops `tabIndex` when content fits.
 */
export function TableScrollRegion({
  label,
  className,
  children,
}: {
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
      // Keep non-literal: Biome's noNoninteractiveTabindex autofix deletes a literal tabIndex={0}.
      tabIndex={scrolls ? 0 : undefined}
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  )
}

function useHorizontalOverflow(ref: RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = useState(true)
  const observerRef = useRef<ResizeObserver | null>(null)
  const observedChildRef = useRef<Element | null>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setOverflows(el.scrollWidth > el.clientWidth)
  }, [ref])

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

  // After every render: measure, and re-observe the current first child (a re-render can replace the table).
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
