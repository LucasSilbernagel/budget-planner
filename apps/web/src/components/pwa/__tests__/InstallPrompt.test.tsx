import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectSharedGreen } from '@/test/white-fill-tokens'
// @ts-expect-error — pwa.config.mjs is plain ESM at the app root with no types.
import { pwaManifest } from '../../../../pwa.config.mjs'
import { InstallPrompt } from '../InstallPrompt'

const DISMISSAL_STORAGE_KEY = 'bp-pwa-install-dismissed'

function createInstallEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
	const event = new Event('beforeinstallprompt')
	const prompt = vi.fn().mockResolvedValue(undefined)
	Object.assign(event, {
		prompt,
		userChoice: Promise.resolve({ outcome, platform: 'web' }),
	})
	const preventDefault = vi.spyOn(event, 'preventDefault')
	return { event, prompt, preventDefault }
}

function fireInstallEvent(event: Event) {
	act(() => {
		window.dispatchEvent(event)
	})
}

function stubStandalone(matches: boolean) {
	vi.stubGlobal(
		'matchMedia',
		vi.fn().mockReturnValue({
			matches,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})
	)
}

beforeEach(() => {
	localStorage.clear()
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('InstallPrompt', () => {
	it('renders nothing before any beforeinstallprompt event', () => {
		render(<InstallPrompt />)
		expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
	})

	it('shows the affordance and suppresses the default mini-infobar after the event fires', () => {
		render(<InstallPrompt />)
		const { event, preventDefault } = createInstallEvent()
		fireInstallEvent(event)

		expect(preventDefault).toHaveBeenCalledTimes(1)
		expect(screen.getByRole('region', { name: /install longhand/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
		expectSharedGreen(screen.getByRole('button', { name: 'Install' }))
	})

	// Derived from the manifest so changing short_name alone fails here.
	it('names the app exactly as the PWA manifest short_name does', () => {
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)

		const { short_name: shortName } = pwaManifest as { short_name: string }
		expect(screen.getByRole('region', { name: `Install ${shortName}` })).toBeInTheDocument()
		expect(screen.getByText(`Install ${shortName}`)).toBeInTheDocument()
	})

	it('does not show when the app is already running standalone', () => {
		stubStandalone(true)
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)

		expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
	})

	it('does not show when dismissed within the suppression interval', () => {
		localStorage.setItem(DISMISSAL_STORAGE_KEY, Date.now().toString())
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)

		expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
	})

	it('shows again once a past dismissal is older than the interval', () => {
		const stale = Date.now() - 31 * 24 * 60 * 60 * 1000
		localStorage.setItem(DISMISSAL_STORAGE_KEY, stale.toString())
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)

		expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
	})

	it('ignores a corrupt dismissal timestamp and still shows', () => {
		localStorage.setItem(DISMISSAL_STORAGE_KEY, 'not-a-number')
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)

		expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
	})

	it('ignores a future dismissal timestamp and still shows', () => {
		// A future timestamp (clock skew / corrupt-but-finite) would otherwise
		// suppress the affordance essentially forever.
		localStorage.setItem(DISMISSAL_STORAGE_KEY, (Date.now() + 60_000).toString())
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)

		expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
	})

	it('does not re-show on a same-session re-fire after dismissal', () => {
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)
		fireEvent.click(screen.getByRole('button', { name: /dismiss install prompt/i }))
		expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()

		// The listener is still attached; a re-fired event must stay suppressed.
		fireInstallEvent(createInstallEvent().event)
		expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
	})

	it('triggers the native install flow when Install is clicked', async () => {
		render(<InstallPrompt />)
		const { event, prompt } = createInstallEvent()
		fireInstallEvent(event)

		fireEvent.click(screen.getByRole('button', { name: 'Install' }))

		await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
		await waitFor(() =>
			expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
		)
	})

	it('hides and remembers the dismissal when the close button is clicked', () => {
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)

		fireEvent.click(screen.getByRole('button', { name: /dismiss install prompt/i }))

		expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
		expect(localStorage.getItem(DISMISSAL_STORAGE_KEY)).not.toBeNull()
	})

	it('dismisses on Escape when the affordance holds focus', () => {
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)
		screen.getByRole('button', { name: 'Install' }).focus()

		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		})

		expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
		expect(localStorage.getItem(DISMISSAL_STORAGE_KEY)).not.toBeNull()
	})

	it('ignores Escape when focus is outside the affordance', () => {
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)

		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		})

		expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
		expect(localStorage.getItem(DISMISSAL_STORAGE_KEY)).toBeNull()
	})

	it('hides when the app reports it was installed', () => {
		render(<InstallPrompt />)
		fireInstallEvent(createInstallEvent().event)
		expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()

		act(() => {
			window.dispatchEvent(new Event('appinstalled'))
		})

		expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
	})
})
