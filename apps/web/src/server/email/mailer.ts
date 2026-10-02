/**
 * Transactional Mailer — EU provider (Story 5-16, Task 4, AC-4)
 *
 * SERVER-ONLY. Sends the magic-link email — and, since Story 73.2, the
 * retention warning before a lapsed account is deleted — through Brevo (Sendinblue), a
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
import { getEmailConfig, getSiteUrl } from '@budget-planner/config'

/** Brevo transactional-email endpoint (EU). */
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'

const SUBJECT = 'Your Longhand Budget sign-in link'

/**
 * Ceiling on one Brevo call (Story 73.2 review). Without it a hung provider
 * held the sign-in request — and the retention sweep, which sends up to a
 * batch of notices in one request — open indefinitely. On expiry `fetch`
 * rejects, and both callers already treat a rejection as a failed send.
 */
export const BREVO_TIMEOUT_MS = 10_000

/**
 * Build the plain-text and HTML bodies for the magic-link email.
 *
 * Deliberately minimal: only the recipient's own login link and the expiry
 * notice. No tracking pixels or remote images (EU privacy posture).
 */
function buildEmailBody(link: string): { html: string; text: string } {
  const text = [
    'Sign in to Longhand Budget',
    '',
    'Click the link below to sign in. It can be used once and expires in 15 minutes:',
    link,
    '',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n')

  const html = [
    '<p>Sign in to <strong>Longhand Budget</strong></p>',
    '<p>Click the button below to sign in. This link can be used once and expires in 15 minutes.</p>',
    // Formal form on the CTA too, deliberately, rather than the short form the
    // naming rule would allow for a second mention (story brand-1, code review).
    // An email is scanned, not read: for many recipients the button is the only
    // string they take in, and a button naming a different product than the
    // subject line is the shape people are taught to distrust. The plain-text
    // part carries the formal form throughout, so this also keeps both MIME
    // parts naming the product identically.
    `<p><a href="${link}">Sign in to Longhand Budget</a></p>`,
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
 *
 * Resolves to Brevo's `messageId` when the 2xx body carries one (Story 74.1,
 * AC-5), so a report can be matched to Brevo's delivery log. Brevo documents the
 * 201 body as `{ "messageId": "<…@relay.domain.com>" }` (checked 2026-09-27 at
 * developers.brevo.com/reference/sendtransacemail). A missing or non-JSON body
 * resolves `undefined` — the send already succeeded, so it must not throw.
 */
export async function sendMagicLinkEmail(to: string, link: string): Promise<string | undefined> {
  const config = getEmailConfig()

  if (!config.isConfigured || !config.apiKey) {
    if (process.env['NODE_ENV'] === 'development') {
      // Dev-only affordance so local sign-in works without an email account.
      // `to` is redacted by the logger; the link survives so it can be copied.
      logger.warn('[mailer] EMAIL_API_KEY not set — magic link generated (dev only, not sent)', {
        to,
        magicLink: link,
      })
      // Story 87.1 (flow F9, decision D2): the e2e mail outbox. The sign-in
      // e2e reads the link from this file, because the token is stored hashed
      // and cannot be read back from the database. Gated on the BUILD-TIME
      // `import.meta.env.DEV` literal, evaluated first: a production build
      // deletes this branch, the variable name and the fs import with it
      // (pinned by `mailer-outbox-dev-seam.guard.test.ts`, proven against the
      // real build by `scripts/check-client-bundle.mjs`). Never a way to send
      // mail: Brevo is still not called.
      if (import.meta.env.DEV && process.env['E2E_MAIL_OUTBOX']) {
        const { appendFile } = await import('node:fs/promises')
        await appendFile(process.env['E2E_MAIL_OUTBOX'], `${JSON.stringify({ to, link })}\n`)
      }
      return undefined
    }
    throw new Error(
      'EMAIL_API_KEY is not configured. Magic-link login requires the EU email provider (NFR1, NFR2).'
    )
  }

  const { html, text } = buildEmailBody(link)

  return sendViaBrevo(config.apiKey, {
    to,
    subject: SUBJECT,
    html,
    text,
    failure: 'sending the magic link',
  })
}

/**
 * The one Brevo POST both emails go through. Throws on a non-2xx; resolves
 * Brevo's `messageId` (or undefined) on success.
 */
async function sendViaBrevo(
  apiKey: string,
  message: { to: string; subject: string; html: string; text: string; failure: string }
): Promise<string | undefined> {
  const config = getEmailConfig()
  const response = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: config.fromName, email: config.from },
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    }),
    signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
  })

  if (!response.ok) {
    // Do not include the provider body (may echo the recipient) in the message.
    throw new Error(`Email provider returned ${response.status} ${message.failure}`)
  }

  return readMessageId(response)
}

/**
 * The deletion date as a person reads it: `14 September 2027`, in UTC — the
 * same `D Month YYYY` shape the legal pages use for their dates.
 */
export function formatDeletionDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(epochMs))
}

/**
 * Build the retention warning (Story 73.2, AC-4). Deliberately carries NO
 * financial data, no tracking and no remote images — only the date, how to
 * keep the data, and how to delete it now. Names the product formally
 * throughout (brand-1), for the same reason as the magic-link email.
 */
function buildRetentionNoticeBody(
  deletionDate: string,
  siteUrl: string
): { html: string; text: string } {
  const pricing = `${siteUrl}/pricing`
  const settings = `${siteUrl}/settings`
  const text = [
    'Your Longhand Budget data will be deleted',
    '',
    `Your Longhand Budget Premium access has ended. As our privacy policy describes, we will delete your account and all of your synced data on or after ${deletionDate}.`,
    '',
    `To keep it, buy Premium again before then: ${pricing}`,
    '',
    `You can also delete your account and synced data yourself now, from Settings: ${settings}`,
    '',
    'You do not need to do anything if you are happy for your data to be deleted.',
  ].join('\n')

  const html = [
    '<p>Your <strong>Longhand Budget</strong> data will be deleted</p>',
    `<p>Your Longhand Budget Premium access has ended. As our privacy policy describes, we will delete your account and all of your synced data on or after <strong>${deletionDate}</strong>.</p>`,
    `<p>To keep it, <a href="${pricing}">buy Longhand Budget Premium again</a> before then.</p>`,
    `<p>You can also delete your account and synced data yourself now, from <a href="${settings}">Settings</a>.</p>`,
    '<p>You do not need to do anything if you are happy for your data to be deleted.</p>',
  ].join('')

  return { html, text }
}

const RETENTION_SUBJECT = 'Your Longhand Budget data will be deleted'

/**
 * Send the retention warning to a lapsed account (Story 73.2, AC-4, D2).
 *
 * Throws on a misconfigured provider or a non-2xx, so the sweep never records
 * a notice that was not accepted — the purge requires one.
 *
 * ⚠️ UNLIKE `sendMagicLinkEmail`, it throws in development too (Story 73.2
 * review). The magic link's dev affordance logs and resolves; here a resolve
 * would be recorded as a delivered notice, and the account deleted 30 days
 * later with no email ever sent.
 */
export async function sendRetentionNoticeEmail(
  to: string,
  { deletionDate }: { deletionDate: string }
): Promise<string | undefined> {
  const config = getEmailConfig()

  if (!config.isConfigured || !config.apiKey) {
    throw new Error(
      'EMAIL_API_KEY is not configured. The retention notice requires the EU email provider (NFR1, NFR2).'
    )
  }

  // Trailing slashes trimmed so a configured `https://host/` cannot produce
  // `https://host//pricing` in the email.
  const { html, text } = buildRetentionNoticeBody(deletionDate, getSiteUrl().replace(/\/+$/, ''))
  return sendViaBrevo(config.apiKey, {
    to,
    subject: RETENTION_SUBJECT,
    html,
    text,
    failure: 'sending the retention notice',
  })
}

/** Brevo's `messageId` from a 2xx body, or undefined — never throws. */
async function readMessageId(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json()
    const messageId = (body as { messageId?: unknown } | null)?.messageId
    return typeof messageId === 'string' && messageId ? messageId : undefined
  } catch {
    return undefined
  }
}
