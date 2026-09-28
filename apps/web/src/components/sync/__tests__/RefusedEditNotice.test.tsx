/**
 * The refused-edit notice's accessibility and wording (story 75.2, AC-1/AC-5).
 *
 * ⚠️ This populates the notice store directly — it tests the COMPONENT. That a
 * real server refusal reaches it is proven by `refused-edit-notice.db.test.tsx`.
 */

import {
  type RefusalNotice,
  addRefusalNotices,
  dismissAllRefusalNotices,
} from '@/lib/sync/refusalNoticeStore'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { RefusedEditNotice, refusalMessage } from '../RefusedEditNotice'

function notice(overrides: Partial<RefusalNotice> = {}): RefusalNotice {
  return {
    key: 'expense:row-1',
    entityType: 'expense',
    name: 'Rent',
    kind: 'expense',
    fallback: 'An expense',
    outcome: 'changed-back',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  act(() => dismissAllRefusalNotices())
})

describe('RefusedEditNotice', () => {
  it('renders nothing while there is no refusal', () => {
    const { container } = render(<RefusedEditNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces each refused row in its OWN alert node, naming it and saying it was not saved', () => {
    render(<RefusedEditNotice />)
    act(() =>
      addRefusalNotices([
        notice(),
        notice({ key: 'expense:row-2', name: 'Gym', outcome: 'removed' }),
      ])
    )
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    expect(alerts[0]).toHaveTextContent(
      "Your change to “Rent” (expense) couldn't be saved to your account, so it is being changed back to what your account has."
    )
    expect(alerts[1]).toHaveTextContent(
      "“Gym” (expense) couldn't be saved to your account, so it was removed from this device."
    )
  })

  it('a later refusal is a NEW alert node — the first node is not rewritten', () => {
    render(<RefusedEditNotice />)
    act(() => addRefusalNotices([notice()]))
    const first = screen.getByRole('alert')
    act(() => addRefusalNotices([notice({ key: 'expense:row-2', name: 'Gym' })]))
    expect(screen.getAllByRole('alert')[0]).toBe(first)
    expect(first).toHaveTextContent('Rent')
    expect(first).not.toHaveTextContent('Gym')
  })

  it('dismissing from the keyboard removes that notice only, and does not move focus on arrival', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Somewhere else</button>
        <RefusedEditNotice />
      </>
    )
    screen.getByRole('button', { name: 'Somewhere else' }).focus()
    act(() => addRefusalNotices([notice(), notice({ key: 'expense:row-2', name: 'Gym' })]))
    // Arrival does not steal focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Somewhere else' }))

    const dismiss = screen.getByRole('button', { name: 'Dismiss notice about “Rent” (expense)' })
    dismiss.focus()
    await user.keyboard('{Enter}')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Gym')
  })

  it('"Dismiss all" appears only for several notices and clears them', () => {
    render(<RefusedEditNotice />)
    act(() => addRefusalNotices([notice()]))
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull()
    act(() => addRefusalNotices([notice({ key: 'expense:row-2', name: 'Gym' })]))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('the text stays in the accessibility tree — the dismiss button is a sibling, not a wrapper (63.1)', () => {
    render(<RefusedEditNotice />)
    act(() => addRefusalNotices([notice()]))
    const button = screen.getByRole('button', { name: /^Dismiss notice/ })
    expect(button).not.toHaveTextContent('Rent')
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved to your account')
  })
})

describe('refusalMessage — the fallback never reads as an empty name', () => {
  it.each([
    [
      'removed',
      "An expense couldn't be saved to your account, so it was removed from this device.",
    ],
    [
      'changed-back',
      "Your change to an expense couldn't be saved to your account, so it is being changed back to what your account has.",
    ],
    [
      'restored',
      "Deleting an expense couldn't be saved to your account, so it is being restored from your account.",
    ],
  ] as const)('%s', (outcome, text) => {
    const message = refusalMessage(notice({ name: null, outcome }))
    expect(message).toBe(text)
    expect(message).not.toMatch(/“”|undefined|null/)
  })

  it('a removed PROFILE says its entries went with it (the tombstone cascades them)', () => {
    expect(
      refusalMessage(
        notice({
          entityType: 'userProfile',
          name: 'Side hustle',
          kind: 'profile',
          outcome: 'removed',
        })
      )
    ).toBe(
      "“Side hustle” (profile) couldn't be saved to your account, so it was removed from this device, together with the entries in it."
    )
  })
})

describe('code review 75.2 fixes', () => {
  it('the same row refused again with a DIFFERENT outcome is a NEW alert node with the new text', () => {
    render(<RefusedEditNotice />)
    act(() => addRefusalNotices([notice()]))
    const first = screen.getByRole('alert')
    act(() => addRefusalNotices([notice({ outcome: 'restored' })]))
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).not.toBe(first)
    expect(alerts[0]).toHaveTextContent('is being restored')
  })

  it('"Dismiss all" comes FIRST and the stack scrolls, so it is reachable however many there are', () => {
    render(<RefusedEditNotice />)
    act(() =>
      addRefusalNotices(
        Array.from({ length: 12 }, (_, i) => notice({ key: `expense:row-${i}`, name: `Row ${i}` }))
      )
    )
    const dismissAll = screen.getByRole('button', { name: 'Dismiss all' })
    const container = dismissAll.parentElement as HTMLElement
    expect(container.firstElementChild).toBe(dismissAll)
    expect(container.className).toMatch(/overflow-y-auto/)
    expect(container.className).toMatch(/max-h-/)
  })

  it('sits above a Modal backdrop (z-50)', () => {
    render(<RefusedEditNotice />)
    act(() => addRefusalNotices([notice()]))
    const container = screen.getByRole('alert').parentElement as HTMLElement
    expect(container.className).toMatch(/\bz-\[60\]/)
  })
})
