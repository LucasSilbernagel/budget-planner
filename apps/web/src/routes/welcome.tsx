import { createFileRoute } from '@tanstack/react-router'

/**
 * Post-checkout landing page — `/welcome` (story 5-3, Task 2a).
 *
 * Paddle Checkout's `settings.successUrl` (see `lib/paddle/checkout.ts`)
 * redirects here once the overlay confirms a purchase. This page does not
 * itself flip anything: the webhook (`routes/api/webhooks/paddle.ts`) is what
 * sets `users.subscriptionStatus` DB-authoritatively, and it can land slightly
 * after the redirect — the copy is deliberately phrased as "check your email"
 * rather than asserting Premium is active yet.
 */
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
    <div className="min-h-screen flex flex-col items-center justify-center surface-sunken p-4">
      <div className="w-full max-w-md text-center">
        <div className="surface shadow-md rounded-2xl p-6 sm:p-8 border border-default">
          <h1 className="text-2xl font-semibold text-heading mb-2">Welcome to Premium 🎉</h1>
          <p className="text-body mb-6">
            Thanks for subscribing! Paddle is finishing up your purchase — this usually takes just a
            few seconds. If Premium features don&apos;t appear right away, refresh the page.
          </p>
          <a
            href="/"
            className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
          >
            Go to your budget
          </a>
        </div>
      </div>
    </div>
  )
}
