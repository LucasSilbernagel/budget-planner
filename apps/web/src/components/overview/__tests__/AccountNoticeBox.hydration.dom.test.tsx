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

/**
 * A dismissed user hydrates the Overview without a mismatch (story 55.1 AC-3;
 * moved below the browser by story 84.3 from
 * `e2e/overview-account-notice.spec.ts` › "a dismissed user gets no hydration
 * error").
 *
 * The server has no localStorage, so it always emits the box. The browser has
 * the dismissal. A component that read storage DURING render would paint
 * nothing on the client's first render, disagreeing with the server HTML, and
 * React 19 reports that through `onRecoverableError`, not a throw. So the server
 * render here runs with storage EMPTY, the dismissal is written, and only then
 * does the client hydrate: the order a real page load has.
 *
 * ⚠️ THE BOX IS NEVER HYDRATED DIRECTLY UNDER THE ROOT (84.3 code review,
 * MEASURED). React 19 tolerates extra server nodes directly under the
 * hydration root (it leaves them in place, reporting nothing), even with a
 * sibling after them; one level down, the same `null` is a "Hydration failed"
 * recoverable error. On the real Overview the box sits deep in the tree, which
 * is why Chromium reported the mismatch there. The `<main>` wrapper reproduces
 * that, and the designed-RED control below proves this harness sees a
 * mismatch at all.
 */

/** Server-render with EMPTY storage, write the dismissal, then hydrate. */
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

/** The defect the AC exists to prevent: reading the dismissal during render. */
function ReadsStorageDuringRender() {
  return wasAccountNoticeDismissed() ? (
    <></>
  ) : (
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
    // Anti-vacuity: the component really ran on the client (its effect read
    // the dismissal and removed the box), so "no error" is not "no hydration".
    expect(boxAfter, 'the box survived hydration for a dismissed user').toBe(false)
  })

  /** ⚠️ DESIGNED RED: proves the harness reports a mismatch when there is one. */
  it('reports a mismatch for a component that reads the dismissal during render (control)', async () => {
    const { recoverable, serverHadBox } = await hydrateAsADismissedUser(ReadsStorageDuringRender)

    expect(serverHadBox).toBe(true)
    expect(recoverable.length, 'the harness cannot see a hydration mismatch').toBeGreaterThan(0)
  })
})
