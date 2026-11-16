// The CA copy pinned in DATABASE_CA_CERT does not auto-renew; once it lapses the pool stops
// connecting. No network I/O, so this can run on every deploy.

import { X509Certificate } from 'node:crypto'

type CaExpiryStatus = 'ok' | 'warn' | 'expired' | 'invalid'

export type CaExpiryResult = {
	status: CaExpiryStatus
	daysRemaining?: number
	notAfter?: string
	subject?: string
}

const MS_PER_DAY = 86_400_000

/** Absent or unparseable input is `invalid`, never `ok`. */
export function assessCaExpiry(
	pem: string | undefined,
	now: Date,
	warnWithinDays: number
): CaExpiryResult {
	if (!pem || pem.trim() === '') {
		return { status: 'invalid' }
	}

	// X509Certificate parses only the first block, so check a pasted chain whole and report on
	// the certificate that expires soonest.
	const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
	const pemBlocks = blocks && blocks.length > 0 ? blocks : [pem]

	let cert: X509Certificate | undefined
	let notAfter: Date | undefined
	for (const block of pemBlocks) {
		let parsed: X509Certificate
		try {
			parsed = new X509Certificate(block)
		} catch {
			return { status: 'invalid' }
		}
		const blockNotAfter = new Date(parsed.validTo)
		if (Number.isNaN(blockNotAfter.getTime())) {
			return { status: 'invalid' }
		}
		if (!notAfter || blockNotAfter.getTime() < notAfter.getTime()) {
			cert = parsed
			notAfter = blockNotAfter
		}
	}

	if (!cert || !notAfter) {
		return { status: 'invalid' }
	}

	// Truncated toward zero so "0 days" reads as urgent.
	const daysRemaining = Math.trunc((notAfter.getTime() - now.getTime()) / MS_PER_DAY)
	const base = {
		daysRemaining,
		notAfter: notAfter.toISOString(),
		subject: cert.subject,
	}

	if (notAfter.getTime() <= now.getTime()) {
		return { status: 'expired', ...base }
	}
	if (daysRemaining <= warnWithinDays) {
		return { status: 'warn', ...base }
	}
	return { status: 'ok', ...base }
}

export function formatCaExpiry(result: CaExpiryResult): string {
	const remedy = [
		'To renew:',
		'  1. DanubeData console → database budget-planner-prod → turn public DNS ON.',
		'  2. scripts/renew-db-ca.sh <port>   (read <port> from `danube db ls`)',
		'     It fetches the chain, picks the self-signed CA, refuses one that has not',
		'     rotated yet, and pushes it to GitHub and Rapids after you confirm.',
		'  3. Turn public DNS back OFF.',
		'Background: .github/DEPLOY_RUNBOOK.md and docs/production-database-runbook.md.',
	].join('\n')

	if (result.status === 'invalid') {
		return [
			'DATABASE_CA_CERT is missing or is not a parseable PEM certificate.',
			'The application pool enforces TLS verification, so it cannot reach the',
			'database without this. Checked without any network access, so this is a',
			'configuration problem, not a connectivity one.',
			'',
			remedy,
		].join('\n')
	}

	const day = (result.notAfter ?? '').slice(0, 10)
	if (result.status === 'expired') {
		return [
			`DATABASE_CA_CERT EXPIRED on ${day} (${Math.abs(result.daysRemaining ?? 0)} days ago).`,
			'The application cannot establish a verified TLS connection to the database.',
			'',
			remedy,
		].join('\n')
	}
	if (result.status === 'warn') {
		return [
			`DATABASE_CA_CERT expires on ${day} — ${result.daysRemaining} days away.`,
			'Everything still works right now. Renew before that date to avoid an outage',
			'that will look like a database failure rather than a certificate one.',
			'',
			remedy,
		].join('\n')
	}
	return `DATABASE_CA_CERT is valid until ${day} (${result.daysRemaining} days).`
}
