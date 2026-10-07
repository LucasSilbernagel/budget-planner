/**
 * `/welcome` page landmarks (story 116.1, FR184, A4).
 *
 * Lighthouse flagged `/welcome` (the post-checkout landing page) for having no
 * `<main>` landmark. The page is reached through `Route.options.component`, as
 * the router invokes it.
 */

import { renderWithRouter, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { Route } from '../welcome'

const WelcomePage = Route.options.component as () => React.ReactElement

describe('/welcome landmarks (story 116.1)', () => {
  it('is exactly one <main> landmark, holding the page heading', async () => {
    renderWithRouter(<WelcomePage />)

    // Awaited first: `renderWithRouter` mounts asynchronously.
    const heading = await screen.findByRole('heading', { level: 1, name: /welcome to premium/i })
    const mains = screen.getAllByRole('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toContainElement(heading)
  })
})
