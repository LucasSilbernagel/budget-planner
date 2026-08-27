/**
 * Public Contact page — `/contact` (story 9-1, FR27 / AC-1).
 *
 * Replaces the old GitHub "new issue" feedback link with a first-party in-app
 * form. Public + static: no auth, no premium gate, no DB, no server route — the
 * form posts client-side to Formspark (see {@link ContactForm}).
 */

import { ContactForm } from '@/components/contact/contact-form'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/contact')({
  head: () => ({
    meta: [
      { title: 'Contact · Longhand Budget' },
      {
        name: 'description',
        content: 'Send feedback or report a bug — your message reaches the developer directly.',
      },
    ],
  }),
  component: ContactPage,
})

function ContactPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Contact</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">
        Have feedback or found a bug? Send a message and it will reach the developer directly. Only
        a message is required — a name and email are optional if you&apos;d like a reply.
      </p>
      <div className="mt-6">
        <ContactForm />
      </div>
    </div>
  )
}
