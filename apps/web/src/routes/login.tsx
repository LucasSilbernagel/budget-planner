import { createFileRoute, redirect } from '@tanstack/react-router'
import { MagicLinkForm } from '@/components/auth/magic-link-form'
import { Card } from '@/components/ui/Card'
import { PageTitle } from '@/components/ui/PageTitle'
import { getSessionSeed } from '@/server/api/auth/session-seed'

// Exported because `routeTree.gen.ts` infers `LoginRoute` from `validateSearch`'s
// return type and cannot name a type that is module-private (TS4023).
export type LoginSearch = {
	error?: string
}

export const Route = createFileRoute('/login')({
	// A null seed (resolver errored) counts as signed-out: fail open to the form
	// rather than risk a redirect loop.
	beforeLoad: async () => {
		const seed = await getSessionSeed()
		if (seed?.isAuthenticated) {
			throw redirect({ to: '/' })
		}
	},
	validateSearch: (search: Record<string, unknown>): LoginSearch => ({
		error: typeof search['error'] === 'string' ? search['error'] : undefined,
	}),
	// "Sign in", not the page's <h1> — that <h1> is the brand wordmark, which
	// would make this tab read "Longhand Budget · Longhand Budget".
	head: () => ({
		meta: [
			{ title: 'Sign in · Longhand Budget' },
			{
				name: 'description',
				content:
					'Sign in with a one-time email link to reach your subscription and synced data on any device.',
			},
		],
	}),
	component: LoginPage,
})

function errorMessage(code: string | undefined): string | undefined {
	if (code === 'invalid_or_expired') {
		return 'That sign-in link was invalid or has expired. Please request a new one.'
	}
	return code ? 'Unable to sign you in. Please request a new link.' : undefined
}

function LoginPage() {
	const { error } = Route.useSearch()

	return (
		<main className="min-h-screen flex flex-col items-center justify-center surface-sunken p-4">
			<div className="w-full max-w-md">
				<div className="text-center mb-8">
					<PageTitle>Longhand Budget</PageTitle>
					<p className="text-body mt-2">Track your finances with privacy and control</p>
				</div>

				<Card className="rounded-2xl sm:p-8 border border-default">
					<div className="text-center">
						<h2 className="text-2xl font-semibold text-heading mb-2">Sign in</h2>
						<p className="text-body mb-6">
							Enter your email and we&apos;ll send you a one-time sign-in link to access your
							subscription and synced data on any device.
						</p>
					</div>

					{/* Magic-link login silently no-ops for unknown emails and accounts are only
              created by checkout, so tell newcomers before they type. */}
					<Card variant="inset" className="mb-6 p-4 border border-default text-left">
						<h3 className="font-medium text-heading mb-1">New here?</h3>
						<p className="text-sm text-body">
							This page is for signing back in — an account is created when you subscribe.
						</p>
						<a
							href="/pricing"
							className="inline-block mt-2 text-sm text-accent hover:underline font-medium"
						>
							See Premium pricing →
						</a>
					</Card>

					<MagicLinkForm initialError={errorMessage(error)} />

					<div className="mt-4 text-center text-sm text-muted">
						<p>
							By signing in, you agree to our{' '}
							<a href="/terms" className="text-accent underline">
								Terms of Service
							</a>{' '}
							and{' '}
							<a href="/privacy" className="text-accent underline">
								Privacy Policy
							</a>
						</p>
					</div>

					{/* surface-inset, not surface-sunken: nested on the card, so it reads lighter. */}
					<Card variant="inset" className="mt-6 p-4 border border-default">
						<h3 className="font-medium text-heading mb-1">No account needed</h3>
						<p className="text-sm text-body">
							You can also use Longhand Budget without an account. Your data will be stored locally
							on this device only.
						</p>
						<a
							href="/"
							className="inline-block mt-2 text-sm text-accent hover:underline font-medium"
						>
							Continue without account →
						</a>
					</Card>
				</Card>
			</div>
		</main>
	)
}
