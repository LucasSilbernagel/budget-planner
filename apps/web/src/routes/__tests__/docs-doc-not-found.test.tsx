/**
 * `DocNotFound` theming guard (story 31-1 review, AC-1/AC-9).
 *
 * AC-1 names the `DocNotFound` branch explicitly and AC-9 requires a guard for
 * every changed component, but the dev pass shipped this branch with THREE
 * changed colour classes and zero coverage at any layer: no unit test rendered
 * it, and `theme-page-coverage.spec.ts` visits only valid slugs so no e2e ever
 * reaches it. Reverting any of the three turned nothing red — the mutation pass
 * could not catch that, because a missing guard has no mutation to run against.
 *
 * The component is imported from the route module directly, the same way
 * `routes/__tests__/profiles.test.tsx:43` imports `ProfilesPage` — `createFileRoute`
 * at module scope is fine under jsdom.
 */

import { render } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { DocNotFound } from '../docs/$docId'

describe('DocNotFound theming', () => {
  it('uses the surface + text tokens, not the light-only classes', () => {
    const { container } = render(<DocNotFound />)

    const card = container.querySelector('main section')
    if (!card) throw new Error('missing not-found card')
    expect([...card.classList]).toContain('surface')
    expect([...card.classList]).not.toContain('bg-white')
    // Colour-only tokens compose with the layout utilities.
    expect([...card.classList]).toContain('rounded-lg')
    expect([...card.classList]).toContain('shadow-md')

    const copy = card.querySelector('p')
    if (!copy) throw new Error('missing not-found copy')
    expect([...copy.classList]).toContain('text-body')
    expect([...copy.classList]).not.toContain('text-gray-600')

    const backLink = card.querySelector('a[href="/docs"]')
    if (!(backLink instanceof HTMLElement)) throw new Error('missing docs index link')
    expect([...backLink.classList]).toContain('text-accent')
    expect([...backLink.classList]).not.toContain('text-blue-600')
  })

  it('renders inside the themed DocsLayout shell, so the 404 canvas darkens too', () => {
    const { container } = render(<DocNotFound />)
    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing layout root')
    expect([...root.classList]).toContain('surface-sunken')

    // The docs 404 is the twin of `NotFoundPage.tsx`, which was already fully
    // dark-aware — the two were divergent before this story.
    const classes = [root, ...root.querySelectorAll('*')].flatMap((element) => [
      ...element.classList,
    ])
    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
  })
})

/**
 * Shared with the other subtree sweeps in this story. A code review found the
 * three sweeps had each grown their OWN list, so the same claim ("no light-only
 * token survives") carried different guarantees per file and the weakest list
 * defined the real protection.
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
