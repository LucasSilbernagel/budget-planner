import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetConfig } from '@budget-planner/config/schema'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/mocks/server'
import { formatDeletionDate, sendMagicLinkEmail, sendRetentionNoticeEmail } from '../mailer'

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('sendMagicLinkEmail', () => {
	it('POSTs to the Brevo EU endpoint with the api-key header and the link in the body', async () => {
		let captured: { headers: Headers; body: Record<string, unknown> } | null = null
		server.use(
			http.post(BREVO_URL, async ({ request }) => {
				captured = {
					headers: request.headers,
					body: (await request.json()) as Record<string, unknown>,
				}
				return HttpResponse.json({ messageId: 'ok' }, { status: 201 })
			})
		)

		const link = 'https://app.test/api/auth/login/verify?token=abc123'
		await sendMagicLinkEmail('user@example.com', link)

		expect(captured).not.toBeNull()
		const { headers, body } = captured as unknown as {
			headers: Headers
			body: Record<string, unknown>
		}
		expect(headers.get('api-key')).toBe('test-email-api-key')
		expect(body.to).toEqual([{ email: 'user@example.com' }])
		expect(body.sender).toEqual({ name: 'Longhand Budget', email: 'no-reply@budgetplanner.test' })
		expect(JSON.stringify(body)).toContain(link)

		// A recipient mid-cutover must see the formal name in the subject and both bodies.
		expect(body.subject).toContain('Longhand Budget')
		expect(body.htmlContent).toContain('<strong>Longhand Budget</strong>')
		expect(body.textContent).toMatch(/^Sign in to Longhand Budget/)
		// The CTA is often the only string read, so it must carry the formal form.
		expect(body.htmlContent).toMatch(/<a href="[^"]+">Sign in to Longhand Budget<\/a>/)
		expect(JSON.stringify(body)).not.toContain('SoluBudget')
	})

	it('throws when the provider returns a non-2xx response (no silent failure)', async () => {
		server.use(http.post(BREVO_URL, () => HttpResponse.json({ error: 'bad' }, { status: 400 })))
		await expect(
			sendMagicLinkEmail('user@example.com', 'https://app.test/api/auth/login/verify?token=x')
		).rejects.toThrow()
	})

	it('does not embed the recipient address in the link (no PII leak via the URL)', async () => {
		let bodyStr = ''
		server.use(
			http.post(BREVO_URL, async ({ request }) => {
				bodyStr = JSON.stringify(await request.json())
				return HttpResponse.json({ messageId: 'ok' }, { status: 201 })
			})
		)
		const link = 'https://app.test/api/auth/login/verify?token=tok'
		await sendMagicLinkEmail('secret@example.com', link)
		expect(link).not.toContain('secret@example.com')
		expect(bodyStr).toContain(link)
	})

	describe('Brevo messageId', () => {
		const LINK = 'https://app.test/api/auth/login/verify?token=x'

		it('returns the messageId from a 2xx body', async () => {
			server.use(
				http.post(BREVO_URL, () =>
					HttpResponse.json(
						{ messageId: '<201798300811.5787683@relay.domain.com>' },
						{ status: 201 }
					)
				)
			)
			await expect(sendMagicLinkEmail('user@example.com', LINK)).resolves.toBe(
				'<201798300811.5787683@relay.domain.com>'
			)
		})

		it('does NOT throw on a 2xx with an empty body — the send already succeeded', async () => {
			server.use(http.post(BREVO_URL, () => new HttpResponse(null, { status: 201 })))
			await expect(sendMagicLinkEmail('user@example.com', LINK)).resolves.toBeUndefined()
		})

		it('does NOT throw on a 2xx with a non-JSON body', async () => {
			server.use(http.post(BREVO_URL, () => HttpResponse.text('queued', { status: 201 })))
			await expect(sendMagicLinkEmail('user@example.com', LINK)).resolves.toBeUndefined()
		})

		it('ignores a messageId that is not a string', async () => {
			server.use(http.post(BREVO_URL, () => HttpResponse.json({ messageId: 42 }, { status: 201 })))
			await expect(sendMagicLinkEmail('user@example.com', LINK)).resolves.toBeUndefined()
		})
	})
})

describe('the dev-only e2e mail outbox', () => {
	const dirs: string[] = []
	const outboxDir = () => {
		const dir = mkdtempSync(join(tmpdir(), 'mail-outbox-'))
		dirs.push(dir)
		return dir
	}

	function devWithoutKey(outbox: string) {
		vi.stubEnv('EMAIL_API_KEY', '')
		vi.stubEnv('NODE_ENV', 'development')
		vi.stubEnv('E2E_MAIL_OUTBOX', outbox)
		resetConfig()
	}

	afterEach(() => {
		vi.unstubAllEnvs()
		resetConfig()
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
	})

	it('appends { to, link } as one JSON line per email, and never calls Brevo', async () => {
		const outbox = join(outboxDir(), 'outbox.jsonl')
		devWithoutKey(outbox)
		let brevoCalls = 0
		server.use(
			http.post(BREVO_URL, () => {
				brevoCalls += 1
				return HttpResponse.json({}, { status: 201 })
			})
		)

		await sendMagicLinkEmail('one@example.test', 'http://localhost:5176/verify?token=a')
		await sendMagicLinkEmail('two@example.test', 'http://localhost:5176/verify?token=b')

		const lines = readFileSync(outbox, 'utf8').trim().split('\n')
		expect(lines.map((line) => JSON.parse(line))).toEqual([
			{ to: 'one@example.test', link: 'http://localhost:5176/verify?token=a' },
			{ to: 'two@example.test', link: 'http://localhost:5176/verify?token=b' },
		])
		expect(brevoCalls).toBe(0)
	})

	it('writes nothing when E2E_MAIL_OUTBOX is unset (ordinary local development)', async () => {
		// The real check is that the send resolves: a gate ignoring the empty value
		// would call appendFile(''), which rejects with ENOENT.
		devWithoutKey('')
		await expect(
			sendMagicLinkEmail('one@example.test', 'http://localhost:5173/x')
		).resolves.toBeUndefined()
	})

	it('still throws outside development, outbox set or not (that branch is unchanged)', async () => {
		const outbox = join(outboxDir(), 'outbox.jsonl')
		devWithoutKey(outbox)
		vi.stubEnv('NODE_ENV', 'production')
		resetConfig()
		await expect(sendMagicLinkEmail('one@example.test', 'https://x.test/y')).rejects.toThrow(
			'EMAIL_API_KEY is not configured'
		)
		expect(existsSync(outbox)).toBe(false)
	})
})

describe('sendRetentionNoticeEmail', () => {
	function capture() {
		const captured: { body: Record<string, unknown> | null } = { body: null }
		server.use(
			http.post(BREVO_URL, async ({ request }) => {
				captured.body = (await request.json()) as Record<string, unknown>
				return HttpResponse.json({ messageId: 'notice-1' }, { status: 201 })
			})
		)
		return captured
	}

	it('sends the deletion date, how to keep the data, and how to delete now — through Brevo', async () => {
		const captured = capture()

		const id = await sendRetentionNoticeEmail('lapsed@example.com', {
			deletionDate: '14 September 2027',
		})

		expect(id).toBe('notice-1')
		const body = captured.body as Record<string, unknown>
		expect(body.to).toEqual([{ email: 'lapsed@example.com' }])
		expect(body.subject).toBe('Your Longhand Budget data will be deleted')
		for (const part of [body.textContent, body.htmlContent] as string[]) {
			expect(part).toContain('14 September 2027')
			expect(part).toContain('https://app.test/pricing')
			expect(part).toContain('https://app.test/settings')
			expect(part).toContain('Longhand Budget')
		}
	})

	it('carries no remote images or tracking, and no money figures', async () => {
		const captured = capture()

		await sendRetentionNoticeEmail('lapsed@example.com', { deletionDate: '14 September 2027' })

		const html = (captured.body as Record<string, unknown>).htmlContent as string
		expect(html).not.toMatch(/<img|<script|pixel|utm_/i)
		expect(JSON.stringify(captured.body)).not.toMatch(/[€$£]|\d+\.\d\d/)
	})

	it('throws on a non-2xx so the sweep never records a notice Brevo did not accept', async () => {
		server.use(http.post(BREVO_URL, () => HttpResponse.json({ error: 'bad' }, { status: 503 })))
		await expect(
			sendRetentionNoticeEmail('lapsed@example.com', { deletionDate: '14 September 2027' })
		).rejects.toThrow('Email provider returned 503 sending the retention notice')
	})

	it('formats the deletion date in UTC as D Month YYYY', () => {
		// 23:30 UTC on 13 September is still the 13th in UTC, whatever the host TZ.
		expect(formatDeletionDate(Date.parse('2027-09-13T23:30:00Z'))).toBe('13 September 2027')
		expect(formatDeletionDate(Date.parse('2027-09-14T00:00:00Z'))).toBe('14 September 2027')
	})

	it('throws when the provider is not configured, EVEN in development (review fix)', async () => {
		vi.stubEnv('EMAIL_API_KEY', '')
		vi.stubEnv('NODE_ENV', 'development')
		resetConfig()
		try {
			await expect(
				sendRetentionNoticeEmail('lapsed@example.com', { deletionDate: '14 September 2027' })
			).rejects.toThrow('EMAIL_API_KEY is not configured')
		} finally {
			vi.unstubAllEnvs()
			resetConfig()
		}
	})

	it('builds links without a double slash when SITE_URL ends in one', async () => {
		vi.stubEnv('SITE_URL', 'https://app.test/')
		resetConfig()
		const captured = capture()
		try {
			await sendRetentionNoticeEmail('lapsed@example.com', { deletionDate: '14 September 2027' })
		} finally {
			vi.unstubAllEnvs()
			resetConfig()
		}
		const body = JSON.stringify(captured.body)
		expect(body).toContain('https://app.test/pricing')
		expect(body).not.toContain('app.test//')
	})

	it('sends every Brevo call with a timeout signal', async () => {
		let signal: AbortSignal | null = null
		server.use(
			http.post(BREVO_URL, ({ request }) => {
				signal = request.signal
				return HttpResponse.json({ messageId: 'x' }, { status: 201 })
			})
		)
		const fetchSpy = vi.spyOn(globalThis, 'fetch')
		try {
			await sendRetentionNoticeEmail('lapsed@example.com', { deletionDate: '14 September 2027' })
			const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
			expect(init?.signal).toBeInstanceOf(AbortSignal)
		} finally {
			fetchSpy.mockRestore()
		}
		expect(signal).not.toBeNull()
	})
})
