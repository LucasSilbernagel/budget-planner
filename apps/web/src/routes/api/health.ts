/** No database dependency, so it stays fast under scale-to-zero and cheap to probe. */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const GET = async (): Promise<Response> => {
  return json({ status: 'ok' }, { status: 200 })
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET,
    },
  },
})
