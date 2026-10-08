import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MetadataProvider, useAnalytics, useMetadata } from '../metadata-context'

function setUrl(search: string): void {
	window.history.replaceState({}, '', `/${search}`)
}

function MetadataProbe() {
	const metadata = useMetadata()
	return <div data-testid="source">{metadata.source ?? 'none'}</div>
}

function AnalyticsProbe() {
	const analytics = useAnalytics()
	const events = analytics.getEvents()
	const last = events.at(-1)
	return (
		<div data-testid="analytics">
			{events.length}:{last?.name ?? 'none'}:{last?.metadata.source ?? 'none'}
		</div>
	)
}

beforeEach(() => {
	localStorage.clear()
	for (const cookie of document.cookie.split(';')) {
		const name = cookie.split('=')[0]?.trim()
		if (name) {
			document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT`
		}
	}
})

afterEach(() => {
	setUrl('')
})

describe('MetadataProvider', () => {
	it('AC-1: captures metadata from the landing URL and exposes it', async () => {
		setUrl('?utm_source=newsletter&utm_campaign=launch')
		render(
			<MetadataProvider>
				<MetadataProbe />
			</MetadataProvider>
		)
		await waitFor(() => expect(screen.getByTestId('source')).toHaveTextContent('newsletter'))
	})

	it('AC-1: feeds the captured metadata into the analytics service', async () => {
		setUrl('?utm_source=twitter')
		render(
			<MetadataProvider>
				<AnalyticsProbe />
			</MetadataProvider>
		)
		await waitFor(() =>
			expect(screen.getByTestId('analytics')).toHaveTextContent('1:page_view:twitter')
		)
	})

	it('AC-1: writes NO cookies and NO localStorage for tracking', async () => {
		setUrl('?utm_source=newsletter')
		render(
			<MetadataProvider>
				<MetadataProbe />
			</MetadataProvider>
		)
		await waitFor(() => expect(screen.getByTestId('source')).toHaveTextContent('newsletter'))
		expect(document.cookie).toBe('')
		expect(localStorage.length).toBe(0)
	})

	it('exposes empty metadata when no tracked params are present', async () => {
		setUrl('?foo=bar')
		render(
			<MetadataProvider>
				<MetadataProbe />
			</MetadataProvider>
		)
		await waitFor(() => expect(screen.getByTestId('source')).toHaveTextContent('none'))
	})

	it('throws when the hooks are used outside the provider', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(() => render(<MetadataProbe />)).toThrow(/MetadataProvider/)
		spy.mockRestore()
	})
})
