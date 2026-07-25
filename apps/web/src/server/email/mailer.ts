/**
 * Transactional Mailer — EU provider (Story 5-16, Task 4, AC-4)
 *
 * SERVER-ONLY. Sends the magic-link email through Brevo (Sendinblue), a
 * France-based provider with EU-only data centers, so a recipient's email
 * address (personal data) never leaves the EU — same data-sovereignty posture
 * as DanubeData (NFR1, NFR2).
 *
 * Implemented as a thin `fetch` call (no SDK dependency) to keep the dependency
 * surface minimal, mirroring the project's "Node crypto / fetch, no JWT dep"
 * approach. The API key is a runtime secret supplied via `EMAIL_API_KEY`
 * (injected by Rapids — never committed) and is sent only in the provider's
 * `api-key` header.
 */

import { logger } from '@/lib/logger'
import { getEmailConfig } from '@budget-planner/config'

/** Brevo transactional-email endpoint (EU). */
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'

const SUBJECT = 'Your SoluBudget sign-in link'

/**
 * Build the plain-text and HTML bodies for the magic-link email.
 *
 * Deliberately minimal: only the recipient's own login link and the expiry
 * notice. No tracking pixels or remote images (EU privacy posture).
 */
function buildEmailBody(link: string): { html: string; text: string } {
  const text = [
    'Sign in to SoluBudget',
    '',
    'Click the link below to sign in. It can be used once and expires in 15 minutes:',
    link,
    '',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n')

  const html = [
    '<p>Sign in to <strong>SoluBudget</strong></p>',
    '<p>Click the button below to sign in. This link can be used once and expires in 15 minutes.</p>',
    `<p><a href="${link}">Sign in to SoluBudget</a></p>`,
    `<p>If the button does not work, copy and paste this URL into your browser:<br>${link}</p>`,
    "<p>If you didn't request this, you can safely ignore this email.</p>",
  ].join('')

  return { html, text }
}

/**
 * Send a magic-link email to `to` containing `link`.
 *
 * Throws on a misconfigured provider (outside development) or a non-2xx provider
 * response, so the caller never reports a successful "we emailed you" on a
 * silent failure. In development without an API key, the link is logged to the
 * server console so local sign-in works without an email account.
 */
export async function sendMagicLinkEmail(to: string, link: string): Promise<void> {
  const config = getEmailConfig()

  if (!config.isConfigured || !config.apiKey) {
    if (process.env.NODE_ENV === 'development') {
      // Dev-only affordance so local sign-in works without an email account.
      // `to` is redacted by the logger; the link survives so it can be copied.
      logger.warn('[mailer] EMAIL_API_KEY not set — magic link generated (dev only, not sent)', {
        to,
        magicLink: link,
      })
      return
    }
    throw new Error(
      'EMAIL_API_KEY is not configured. Magic-link login requires the EU email provider (NFR1, NFR2).'
    )
  }

  const { html, text } = buildEmailBody(link)

  const response = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      'api-key': config.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: config.fromName, email: config.from },
      to: [{ email: to }],
      subject: SUBJECT,
      htmlContent: html,
      textContent: text,
    }),
  })

  if (!response.ok) {
    // Do not include the provider body (may echo the recipient) in the message.
    throw new Error(`Email provider returned ${response.status} sending the magic link`)
  }
}
