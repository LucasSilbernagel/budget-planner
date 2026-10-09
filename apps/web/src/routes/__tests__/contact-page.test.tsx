import { describe, expect, it } from 'vitest'
import { renderWithRouter, screen } from '@/test/utils'
import { Route } from '../contact'

const ContactPage = Route.options.component as () => React.ReactElement

describe('/contact landmarks', () => {
	it('is exactly one <main> landmark, holding the page heading', async () => {
		renderWithRouter(<ContactPage />)

		const heading = await screen.findByRole('heading', { level: 1, name: /^contact$/i })
		const mains = screen.getAllByRole('main')
		expect(mains).toHaveLength(1)
		expect(mains[0]).toContainElement(heading)
	})
})
