import { fireEvent, renderWithProviders, screen } from '@/test/utils'
import { describe, expect, it, vi } from 'vitest'
import { RowMoveControls } from '../RowMoveControls'

/**
 * The per-row move controls (story 34.1b) and the sort-forced disabled state
 * story 34.2 added.
 *
 * ⚠️ This component shipped in 34.1b with NO test of its own — it was covered
 * only through the four page suites. That is exactly the shape 30-4b and 33.3
 * each shipped a HIGH from, and 34.2's `disabled` prop is the mechanism that
 * stops a column sort and a manual move contradicting each other, so it gets a
 * direct test rather than four indirect ones.
 *
 * ⚠️ `toBeDisabled()` is the WRONG matcher here and will not pass. These controls
 * use `aria-disabled` deliberately (34.1b decision 2): a natively disabled button
 * cannot hold focus, so moving a row to position 0 would strand the keyboard
 * user at exactly the boundary the disabled state is about. `aria-disabled` is
 * advisory only, so the handler guard has to be asserted separately — an
 * attribute assertion alone would pass against a control that still moved rows.
 */

function renderControls(props: Partial<Parameters<typeof RowMoveControls>[0]> = {}) {
  const onMove = vi.fn()
  renderWithProviders(
    <RowMoveControls label="Salary" isFirst={false} isLast={false} onMove={onMove} {...props} />
  )
  return {
    onMove,
    up: screen.getByRole('button', { name: 'Move Salary up' }),
    down: screen.getByRole('button', { name: 'Move Salary down' }),
  }
}

describe('RowMoveControls', () => {
  it('names both controls after the row they move', () => {
    const { up, down } = renderControls()
    expect(up).toBeInTheDocument()
    expect(down).toBeInTheDocument()
  })

  it('is live for an interior row', () => {
    const { up, down, onMove } = renderControls()
    expect(up).toHaveAttribute('aria-disabled', 'false')
    expect(down).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(up)
    fireEvent.click(down)
    expect(onMove).toHaveBeenCalledTimes(2)
    expect(onMove).toHaveBeenNthCalledWith(1, 'up')
    expect(onMove).toHaveBeenNthCalledWith(2, 'down')
  })

  it('disables move-up on the first row, and the click is a real no-op', () => {
    const { up, down, onMove } = renderControls({ isFirst: true })
    expect(up).toHaveAttribute('aria-disabled', 'true')
    expect(down).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(up)
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.click(down)
    expect(onMove).toHaveBeenCalledExactlyOnceWith('down')
  })

  it('disables move-down on the last row, and the click is a real no-op', () => {
    const { up, down, onMove } = renderControls({ isLast: true })
    expect(down).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(down)
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.click(up)
    expect(onMove).toHaveBeenCalledExactlyOnceWith('up')
  })

  it('keeps a disabled control FOCUSABLE', () => {
    // The whole reason for `aria-disabled` over the native attribute: a row
    // moved into position 0 must not drop focus to <body>, or repeated key
    // presses stop working.
    const { up } = renderControls({ isFirst: true })
    up.focus()
    expect(up).toHaveFocus()
  })

  describe('story 34.2 — forced disabled while a column sort is active', () => {
    it('disables BOTH controls on an interior row', () => {
      const { up, down, onMove } = renderControls({ disabled: true })
      expect(up).toHaveAttribute('aria-disabled', 'true')
      expect(down).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(up)
      fireEvent.click(down)
      expect(onMove).not.toHaveBeenCalled()
    })

    it('leaves the accessible names untouched', () => {
      // The four page suites enumerate these names to assert focus rings and tap
      // targets. A control renamed while sorted would silently drop out of those
      // loops instead of failing them.
      const { up, down } = renderControls({ disabled: true })
      expect(up).toHaveAccessibleName('Move Salary up')
      expect(down).toHaveAccessibleName('Move Salary down')
    })

    it('stays focusable while forced disabled', () => {
      const { down } = renderControls({ disabled: true })
      down.focus()
      expect(down).toHaveFocus()
    })

    it('defaults to enabled when the prop is omitted', () => {
      // Guards the default: `disabled` is optional, and a wrong default would
      // disable every arrow on all four pages at once.
      const { up, onMove } = renderControls()
      fireEvent.click(up)
      expect(up).toHaveAttribute('aria-disabled', 'false')
      expect(onMove).toHaveBeenCalledExactlyOnceWith('up')
    })
  })
})
