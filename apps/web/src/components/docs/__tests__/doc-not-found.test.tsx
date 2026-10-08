import { render } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { DocNotFound } from '../doc-not-found'

describe('DocNotFound theming', () => {
  it('uses the surface + text tokens, not the light-only classes', () => {
    const { container } = render(<DocNotFound />)

    const card = container.querySelector('main section')
    if (!card) throw new Error('missing not-found card')
    expect([...card.classList]).toContain('surface')
    expect([...card.classList]).not.toContain('bg-white')
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
    // Link colour is 1.13:1 against body text, so it needs a non-colour cue (underline).
    expect([...backLink.classList]).toContain('underline')
    expect([...backLink.classList]).not.toContain('hover:underline')
  })

  it('renders inside the themed DocsLayout shell, so the 404 canvas darkens too', () => {
    const { container } = render(<DocNotFound />)
    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing layout root')
    expect([...root.classList]).toContain('surface-sunken')

    const classes = [root, ...root.querySelectorAll('*')].flatMap((element) => [
      ...element.classList,
    ])
    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
  })
})

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
