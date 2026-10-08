import { act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY,
  wasAccountNoticeDismissed,
} from '../../../lib/overview/account-notice-dismissal'
import { AccountNoticeBox } from '../AccountNoticeBox'

// React 19 ignores extra server nodes directly under the hydration root, so the box is
// nested in <main> as on the real page.

async function hydrateAsADismissedUser(Component: () => ReactElement | null) {
  localStorage.clear()
  const page = () => (
    <main>
      <Component />
      <p>The rest of the Overview</p>
    </main>
  )
  const container = document.createElement('div')
  container.innerHTML = renderToString(page())
  document.body.appendChild(container)
  const serverHadBox = container.querySelector('[data-account-notice]') !== null

  localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, '1')

  const recoverable: string[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, page(), {
      onRecoverableError: (error) => recoverable.push(String(error)),
    })
  })
  const boxAfter = container.querySelector('[data-account-notice]') !== null
  act(() => root?.unmount())
  container.remove()
  return { recoverable, serverHadBox, boxAfter }
}

function ReadsStorageDuringRender() {
  return wasAccountNoticeDismissed() ? null : (
    <div data-account-notice>
      <p>No account needed</p>
    </div>
  )
}

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-dismiss-account-notice')
})

describe('AccountNoticeBox — hydration for a dismissed user (AC-3)', () => {
  it('hydrates the server HTML with no recoverable error, then removes the box', async () => {
    const { recoverable, serverHadBox, boxAfter } = await hydrateAsADismissedUser(AccountNoticeBox)

    expect(serverHadBox, 'the server HTML has no box').toBe(true)
    expect(recoverable, `hydration errors: ${recoverable.join(' | ')}`).toEqual([])
    // Anti-vacuity: the client effect really ran, so "no error" is not "no hydration".
    expect(boxAfter, 'the box survived hydration for a dismissed user').toBe(false)
  })

  /** Designed RED: proves the harness reports a mismatch when there is one. */
  it('reports a mismatch for a component that reads the dismissal during render (control)', async () => {
    const { recoverable, serverHadBox } = await hydrateAsADismissedUser(ReadsStorageDuringRender)

    expect(serverHadBox).toBe(true)
    expect(recoverable.length, 'the harness cannot see a hydration mismatch').toBeGreaterThan(0)
  })
})
