/**
 * Contact form component tests (story 9-1, AC-1/AC-2/AC-4/AC-5).
 *
 * Covers inline field-level validation (no alert()), the honeypot, the async
 * submit states (busy, success, generic error), graceful-degrade when the
 * Formspark id is unset, and that a successful submit POSTs the right JSON to
 * `submit-form.com`. The Formspark call is MSW-mocked — no real network (NFR8).
 */

import { server } from '@/mocks/server'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContactForm } from '../contact-form'

const FORM_ID = 'test-form-id'
const SUBMIT_URL = `https://submit-form.com/${FORM_ID}`
const validMessage = 'This is a genuinely useful piece of feedback.'

afterEach(() => {
  vi.unstubAllEnvs()
})

function stubFormId(id: string = FORM_ID) {
  vi.stubEnv('VITE_FORMSPARK_FORM_ID', id)
}

describe('ContactForm', () => {
  it('shows an inline field error (not alert) for an empty message', async () => {
    stubFormId()
    const user = userEvent.setup()
    render(<ContactForm />)

    await user.click(screen.getByRole('button', { name: /send message/i }))

    const error = await screen.findByText(/please enter a message/i)
    expect(error).toHaveAttribute('role', 'alert')
    expect(screen.getByLabelText(/message/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows an inline error for a too-short message', async () => {
    stubFormId()
    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/message/i), 'too short')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument()
  })

  it('caps the message at the maximum length via maxLength (the >max branch is unit-tested)', async () => {
    stubFormId()
    const user = userEvent.setup()
    render(<ContactForm />)

    const textarea = screen.getByLabelText(/message/i) as HTMLTextAreaElement
    expect(textarea).toHaveAttribute('maxLength', '2000')
    await user.click(textarea)
    await user.paste('a'.repeat(2500))
    expect(textarea.value.length).toBe(2000)
  })

  it('shows an inline error for a malformed email when one is entered', async () => {
    stubFormId()
    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/message/i), validMessage)
    await user.type(screen.getByLabelText(/email/i), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    const error = await screen.findByText(/valid email address/i)
    expect(error).toHaveAttribute('role', 'alert')
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('does not error when the email is omitted', async () => {
    stubFormId()
    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/message/i), validMessage)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    await screen.findByRole('status')
    expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument()
  })

  it('renders a hidden honeypot field removed from the a11y tree and tab order', () => {
    stubFormId()
    render(<ContactForm />)

    const honeypot = screen.getByTestId('contact-honeypot')
    expect(honeypot).toHaveAttribute('name', '_gotcha')
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    // The `hidden` utility (display:none) removes it from the a11y tree, tab
    // order, and focus. (jsdom loads no CSS, so we assert the class rather than
    // computed visibility.)
    expect(honeypot).toHaveClass('hidden')
  })

  it('posts the message payload to submit-form.com and shows a confirmation on success', async () => {
    stubFormId()
    let captured: Record<string, unknown> | null = null
    server.use(
      http.post(SUBMIT_URL, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ success: true }, { status: 200 })
      })
    )

    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/name/i), 'Jane')
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.type(screen.getByLabelText(/message/i), validMessage)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    const confirmation = await screen.findByRole('status')
    expect(confirmation).toHaveTextContent(/your message has been sent/i)

    await waitFor(() => expect(captured).not.toBeNull())
    // The empty honeypot is sent so Formspark's server-side check can also act.
    expect(captured).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
      message: validMessage,
      _gotcha: '',
    })
  })

  it('trims whitespace-padded values before posting', async () => {
    stubFormId()
    let captured: Record<string, unknown> | null = null
    server.use(
      http.post(SUBMIT_URL, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ success: true }, { status: 200 })
      })
    )

    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/name/i), '  Jane  ')
    await user.type(screen.getByLabelText(/email/i), '  jane@example.com  ')
    await user.type(screen.getByLabelText(/message/i), `  ${validMessage}  `)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    await screen.findByRole('status')
    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
      message: validMessage,
      _gotcha: '',
    })
  })

  it('sets aria-busy on the button while the submission is in flight', async () => {
    stubFormId()
    let resolveResponse: (() => void) | undefined
    server.use(
      http.post(
        SUBMIT_URL,
        () =>
          new Promise((resolve) => {
            resolveResponse = () => resolve(HttpResponse.json({ success: true }, { status: 200 }))
          })
      )
    )

    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/message/i), validMessage)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    const button = await screen.findByRole('button', { name: /sending/i })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()

    resolveResponse?.()
    await screen.findByRole('status')
  })

  it('shows a generic error when the submission fails (non-2xx)', async () => {
    stubFormId()
    server.use(http.post(SUBMIT_URL, () => HttpResponse.json({ error: 'nope' }, { status: 500 })))

    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/message/i), validMessage)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(
      await screen.findByText(/something went wrong sending your message/i)
    ).toBeInTheDocument()
  })

  it('degrades gracefully (no POST) when the Formspark id is unset', async () => {
    vi.stubEnv('VITE_FORMSPARK_FORM_ID', '')
    let posted = false
    server.use(
      http.post(/^https?:\/\/submit-form\.com\//, () => {
        posted = true
        return HttpResponse.json({ success: true }, { status: 200 })
      })
    )

    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/message/i), validMessage)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('drops a filled honeypot without posting (silent success)', async () => {
    stubFormId()
    let posted = false
    server.use(
      http.post(/^https?:\/\/submit-form\.com\//, () => {
        posted = true
        return HttpResponse.json({ success: true }, { status: 200 })
      })
    )

    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/message/i), validMessage)
    // A bot fills the hidden honeypot; a real user never would.
    const honeypot = screen.getByTestId('contact-honeypot')
    await user.type(honeypot, 'i-am-a-bot')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    await screen.findByRole('status')
    expect(posted).toBe(false)
  })

  it('lets the user send another message after a success (form stays usable)', async () => {
    stubFormId()
    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText(/message/i), validMessage)
    await user.click(screen.getByRole('button', { name: /send message/i }))
    await screen.findByRole('status')

    // The form is still mounted; editing a field clears the confirmation and the
    // fields were reset, so a second message can be sent without a page reload.
    const messageField = screen.getByLabelText(/message/i) as HTMLTextAreaElement
    expect(messageField.value).toBe('')
    await user.type(messageField, 'A second, equally useful message.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send message/i })).toBeEnabled()
  })
})
