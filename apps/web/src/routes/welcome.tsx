import { createFileRoute } from '@tanstack/react-router'

// The CTA points at /login: checkout is not auth-gated, so most buyers here have no session yet.
export const Route = createFileRoute('/welcome')({
  head: () => ({
    meta: [
      { title: 'Welcome · Longhand Budget' },
      {
        name: 'description',
        content: 'Thanks for subscribing to Longhand Budget Premium.',
      },
    ],
  }),
  component: WelcomePage,
})

function WelcomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center surface-sunken p-4">
      <div className="w-full max-w-md text-center">
        <div className="surface shadow-md rounded-2xl p-6 sm:p-8 border border-default">
          <h1 className="text-2xl font-semibold text-heading mb-2">Welcome to Premium 🎉</h1>
          <p className="text-body mb-6">
            Thanks for subscribing! Paddle is finishing up your purchase — this usually takes just a
            few seconds. Sign in with the email you used at checkout to reach your account;
            we&apos;ll email you a one-time sign-in link.
          </p>
          <a
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
          >
            Sign in to your account
          </a>
          {/* Before the webhook lands, sign-in silently sends no email; this retry hint is the only cue. */}
          <p className="text-xs text-muted mt-4">
            No email after a few seconds? Wait a moment, then{' '}
            <a href="/login" className="underline hover:no-underline">
              request the sign-in link again
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  )
}
