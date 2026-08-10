import { render } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { DocsLayout } from '../docs-layout'

/**
 * DocsLayout theming guards (story 31-1, AC-1/AC-7/AC-8).
 *
 * This component owns the `/docs` page canvas and header chrome and had no test
 * file before this story. It is asserted on class-TOKEN membership, never
 * substrings: `-` and `:` are not word boundaries, so `toContain('bg-gray-50')`
 * on a className string would false-match `dark:bg-gray-50` and `hover:bg-gray-50`
 * alike (the documented anti-pattern in `dark-mode-overrides.test.tsx:24,32`).
 *
 * The negative sweep covers the layout AND the sidebar it renders, because both
 * are in this story's scope; `hover:`-prefixed light values are deliberately NOT
 * in the retired list — they are distinct tokens and the sidebar still carries a
 * legitimate `hover:bg-gray-100`.
 */

/** Every class token on the subtree, so a light-only leak anywhere is caught. */
function sweep(root: HTMLElement): string[] {
  return [root, ...root.querySelectorAll('*')].flatMap((element) => [...element.classList])
}

/**
 * The retired light-only set, kept IDENTICAL across every subtree sweep in this
 * story. A code review found the sweeps had each grown their own list — the
 * legal one omitted `text-gray-700` and all of them omitted borders — so the
 * same claim carried different guarantees per file and the weakest list defined
 * the real protection. Any addition here must be made in all four sweeps.
 */
const RETIRED_LIGHT_ONLY_TOKENS = [
  'bg-white',
  'bg-gray-50',
  'text-gray-900',
  'text-gray-800',
  'text-gray-700',
  'text-gray-600',
  'text-gray-500',
  'text-blue-600',
  'text-blue-700',
  'border-gray-200',
] as const

function renderLayout() {
  const { container } = render(
    <DocsLayout title="Documentation" description="Guides and answers.">
      <p>Body</p>
    </DocsLayout>
  )
  const root = container.firstElementChild
  if (!(root instanceof HTMLElement)) throw new Error('DocsLayout rendered no root element')
  return root
}

describe('DocsLayout theming', () => {
  it('paints the page canvas with the surface-sunken token', () => {
    const root = renderLayout()
    const tokens = [...root.classList]
    expect(tokens).toContain('surface-sunken')
    // The layout utilities the token composes with must survive the swap.
    expect(tokens).toContain('min-h-screen')
    expect(tokens).not.toContain('bg-gray-50')
  })

  it('uses the semantic text tokens for the header chrome', () => {
    const root = renderLayout()

    const backLink = root.querySelector('a[href="/"]')
    if (!(backLink instanceof HTMLElement)) throw new Error('missing back link')
    expect([...backLink.classList]).toContain('text-accent')
    expect([...backLink.classList]).not.toContain('text-blue-600')

    const heading = root.querySelector('h1')
    if (!heading) throw new Error('missing h1')
    expect([...heading.classList]).toContain('text-heading')

    const description = root.querySelector('header p')
    if (!description) throw new Error('missing description')
    expect([...description.classList]).toContain('text-body')
  })

  it('leaves no light-only colour token anywhere in the docs shell', () => {
    const classes = sweep(renderLayout())
    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
  })
})
