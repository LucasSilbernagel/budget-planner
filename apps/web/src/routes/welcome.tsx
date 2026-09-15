import { createFileRoute } from '@tanstack/react-router'

/**
 * Post-checkout landing page — `/welcome` (story 5-3, Task 2a).
 *
 * Paddle Checkout's `settings.successUrl` (see `lib/paddle/checkout.ts`)
 * redirects here once the overlay confirms a purchase. This page does not
 * itself flip anything: the webhook (`routes/api/webhooks/paddle.ts`) is what
 * creates the account and sets `users.subscriptionStatus` DB-authoritatively,
 * and it can land slightly after the redirect.
 *
 * The CTA points at `/login`, not `/` — checkout is NOT auth-gated
 * (`PremiumCheckoutButton`), so most visitors landing here just bought as a
 * brand-new customer with no browser session yet. Their account now exists
 * (or will, within seconds), but they still need a magic-link sign-in to
 * actually reach it — sending them to `/` first would just show the
 * signed-out free tier.
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
            few seconds. Sign in with the email you used at checkout to reach your account;
            we&apos;ll email you a one-time sign-in link.
          </p>
          <a
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
          >
            Sign in to your account
          </a>
          {/* A buyer who clicks "Sign in" before the webhook lands gets the
              magic-link endpoint's generic 200 (it never signals whether an
              account exists — no enumeration) and no email, which otherwise
              looks identical to the permanent failure case. This is the ONE
              thing that distinguishes them: retry guidance for the ordinary
              "just a few seconds behind" case. Consistent with the "few
              seconds" framing above (a prior "a minute" here read as
              contradictory), and links back to the same sign-in form the
              button above opens rather than only naming the action. */}
          <p className="text-xs text-muted mt-4">
            No email after a few seconds? Wait a moment, then{' '}
            <a href="/login" className="underline hover:no-underline">
              request the sign-in link again
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
