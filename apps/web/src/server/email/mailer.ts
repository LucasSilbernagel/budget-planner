/** Brevo (EU data centres) via plain fetch, so recipient addresses never leave the EU. */

import { getEmailConfig, getSiteUrl } from '@budget-planner/config/schema'
import { logger } from '@/lib/logger'

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'

const SUBJECT = 'Your Longhand Budget sign-in link'

/** Without a ceiling a hung provider holds sign-in and the retention sweep open. */
const BREVO_TIMEOUT_MS = 10_000

/** No tracking pixels or remote images (EU privacy posture). */
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
		// Formal product name on the CTA too: the button is often the only string
		// read, and it must name the same product as the subject line.
		`<p><a href="${link}">Sign in to Longhand Budget</a></p>`,
		`<p>If the button does not work, copy and paste this URL into your browser:<br>${link}</p>`,
		"<p>If you didn't request this, you can safely ignore this email.</p>",
	].join('')

	return { html, text }
}

/**
 * Throws outside development on a misconfigured provider or non-2xx, so the caller never
 * reports a silent failure. A missing or non-JSON 2xx body resolves undefined.
 */
export async function sendMagicLinkEmail(to: string, link: string): Promise<string | undefined> {
	const config = getEmailConfig()

	if (!config.isConfigured || !config.apiKey) {
		if (process.env['NODE_ENV'] === 'development') {
			// `to` is redacted by the logger; the link survives so it can be copied.
			logger.warn('[mailer] EMAIL_API_KEY not set — magic link generated (dev only, not sent)', {
				to,
				magicLink: link,
			})
			// e2e outbox, since the hashed token can't be read back from the DB.
			// Build-time import.meta.env.DEV goes first so production builds delete the branch.
			if (import.meta.env.DEV && process.env['E2E_MAIL_OUTBOX']) {
				const { appendFile } = await import('node:fs/promises')
				await appendFile(process.env['E2E_MAIL_OUTBOX'], `${JSON.stringify({ to, link })}\n`)
			}
			return undefined
		}
		throw new Error(
			'EMAIL_API_KEY is not configured. Magic-link login requires the EU email provider.'
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

export function formatDeletionDate(epochMs: number): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(epochMs))
}

/** Deliberately no financial data, tracking or remote images. */
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
 * Unlike sendMagicLinkEmail this throws in development too: a resolve would be
 * recorded as a delivered notice and the account deleted with no email sent.
 */
export async function sendRetentionNoticeEmail(
	to: string,
	{ deletionDate }: { deletionDate: string }
): Promise<string | undefined> {
	const config = getEmailConfig()

	if (!config.isConfigured || !config.apiKey) {
		throw new Error(
			'EMAIL_API_KEY is not configured. The retention notice requires the EU email provider.'
		)
	}

	const { html, text } = buildRetentionNoticeBody(deletionDate, getSiteUrl().replace(/\/+$/, ''))
	return sendViaBrevo(config.apiKey, {
		to,
		subject: RETENTION_SUBJECT,
		html,
		text,
		failure: 'sending the retention notice',
	})
}

async function readMessageId(response: Response): Promise<string | undefined> {
	try {
		const body: unknown = await response.json()
		const messageId = (body as { messageId?: unknown } | null)?.messageId
		return typeof messageId === 'string' && messageId ? messageId : undefined
	} catch {
		return undefined
	}
}
