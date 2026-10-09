import { describe, expect, it } from 'vitest'
import { renderWithRouter, screen } from '@/test/utils'
import { NotFoundPage } from '../NotFoundPage'

describe('NotFoundPage', () => {
	it('renders exactly one h1, reading "Page not found"', async () => {
		renderWithRouter(<NotFoundPage />)
		const headings = await screen.findAllByRole('heading', { level: 1 })
		expect(headings).toHaveLength(1)
		expect(headings[0]).toHaveTextContent(/page not found/i)
	})

	it('keeps the decorative "404" out of the heading tree', async () => {
		renderWithRouter(<NotFoundPage />)
		expect(await screen.findByText('404')).toBeInTheDocument()
		expect(screen.queryByRole('heading', { name: '404' })).not.toBeInTheDocument()
	})

	it('shows the "Longhand Budget" brand wordmark', async () => {
		renderWithRouter(<NotFoundPage />)
		expect(await screen.findByText('Longhand Budget')).toBeInTheDocument()
		expect(screen.queryByText(/solubudget/i)).toBeNull()
	})

	it('offers an accessible recovery link to the home/dashboard', async () => {
		renderWithRouter(<NotFoundPage />)
		const link = await screen.findByRole('link', { name: /go home/i })
		expect(link).toHaveAttribute('href', '/')
	})

	it('renders inside a single main landmark', async () => {
		renderWithRouter(<NotFoundPage />)
		expect(await screen.findByRole('main')).toBeInTheDocument()
	})
})
