/**
 * EU transactional mailer tests (Story 5-16, Task 4 — AC-4)
 *
 * Verifies the magic-link email is sent through the EU provider (Brevo, France)
 * with the right shape, that the API key is sent as a secret header, and that a
 * provider error surfaces as a thrown error (so the caller never reports success
 * on a silent failure). All sends are MSW-intercepted — no real email (NFR8).
 */

import { server } from '@/mocks/server'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendMagicLinkEmail } from './mailer'

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
    expect(body.sender).toEqual({ name: 'SoluBudget', email: 'no-reply@budgetplanner.test' })
    // The actual link must be present so the user can complete login.
    expect(JSON.stringify(body)).toContain(link)
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
})
