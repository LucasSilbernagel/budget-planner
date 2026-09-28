/**
 * EU transactional mailer tests (Story 5-16, Task 4 — AC-4)
 *
 * Verifies the magic-link email is sent through the EU provider (Brevo, France)
 * with the right shape, that the API key is sent as a secret header, and that a
 * provider error surfaces as a thrown error (so the caller never reports success
 * on a silent failure). All sends are MSW-intercepted — no real email (NFR8).
 */

import { server } from '@/mocks/server'
import { resetConfig } from '@budget-planner/config'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDeletionDate, sendMagicLinkEmail, sendRetentionNoticeEmail } from './mailer'

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
    // Secret travels in the provider's header, not the URL or body.
    expect(headers.get('api-key')).toBe('test-email-api-key')
    expect(body.to).toEqual([{ email: 'user@example.com' }])
    expect(body.sender).toEqual({ name: 'Longhand Budget', email: 'no-reply@budgetplanner.test' })
    // The actual link must be present so the user can complete login.
    expect(JSON.stringify(body)).toContain(link)

    // brand-1 AC-4: a recipient mid-cutover must not be shown a name they do
    // not recognise, so the FORMAL "Longhand Budget" has to appear in the
    // subject and on first mention in both bodies. Before brand-1 only the
    // sender name was pinned, so the subject and bodies could have drifted or
    // half-renamed with the suite still green.
    expect(body.subject).toContain('Longhand Budget')
    expect(body.htmlContent).toContain('<strong>Longhand Budget</strong>')
    expect(body.textContent).toMatch(/^Sign in to Longhand Budget/)
    // The CTA anchor specifically (code review): for many recipients the button
    // is the ONLY string they read, so it must carry the formal form and match
    // the subject line. Previously unpinned, which is how it drifted to the
    // short form unnoticed. Asserts the anchor text, not just "somewhere".
    expect(body.htmlContent).toMatch(/<a href="[^"]+">Sign in to Longhand Budget<\/a>/)
    // The retired brand must not survive anywhere in the payload.
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
    // The link itself carries only the opaque token, never the email.
    expect(link).not.toContain('secret@example.com')
    expect(bodyStr).toContain(link)
  })

  describe('Brevo messageId (Story 74.1, AC-5)', () => {
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

describe('sendRetentionNoticeEmail (Story 73.2, AC-4)', () => {
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
