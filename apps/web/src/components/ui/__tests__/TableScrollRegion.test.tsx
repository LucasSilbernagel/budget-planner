import {
  restoreRegionWidths,
  setRegionFits as setFits,
  setRegionOverflows as setOverflows,
  stubRegionWidths,
} from '@/test/region-widths'
import { act, render, screen } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableScrollRegion } from '../TableScrollRegion'

// jsdom has no layout, so widths and ResizeObserver are stubbed; cases differ only in the stubbed widths.

/** A ResizeObserver that records what it watches and can be fired by hand. */
class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = []
  readonly targets = new Set<Element>()
  constructor(private readonly callback: ResizeObserverCallback) {
    RecordingResizeObserver.instances.push(this)
  }
  observe(target: Element): void {
    this.targets.add(target)
  }
  unobserve(target: Element): void {
    this.targets.delete(target)
  }
  disconnect(): void {
    this.targets.clear()
  }
  fire(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function fireResize(): void {
  act(() => {
    for (const ro of RecordingResizeObserver.instances) ro.fire()
  })
}

function Region({ rows = 1 }: { rows?: number }) {
  return (
    <TableScrollRegion label="Income sources table" className="overflow-x-auto shadow-token">
      <table>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static fixture rows
            <tr key={i}>
              <td>Row {i}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScrollRegion>
  )
}

beforeEach(() => {
  RecordingResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver)
  stubRegionWidths()
  setFits()
})

afterEach(() => {
  vi.unstubAllGlobals()
  restoreRegionWidths()
})

function region(): HTMLElement {
  return screen.getByRole('region', { name: 'Income sources table' })
}

describe('TableScrollRegion', () => {
  it('server render is focusable: tabindex="0", role and name (no JS, no measurement)', () => {
    setFits() // even a table that WILL fit: the server cannot know
    const html = renderToString(<Region />)
    const host = document.createElement('div')
    host.innerHTML = html
    const el = host.firstElementChild as HTMLElement
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.getAttribute('role')).toBe('region')
    expect(el.getAttribute('aria-label')).toBe('Income sources table')
    expect(el.className).toBe('overflow-x-auto shadow-token')
  })

  it('hydrates the server markup with no mismatch, then drops the stop if the table fits', async () => {
    setFits()
    const host = document.createElement('div')
    host.innerHTML = renderToString(<Region />)
    document.body.appendChild(host)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recoverable: unknown[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(host, <Region />, {
        onRecoverableError: (error) => recoverable.push(error),
      })
    })
    expect(recoverable).toEqual([])
    expect(errors).not.toHaveBeenCalled()
    const el = host.firstElementChild as HTMLElement
    expect(el.hasAttribute('tabindex')).toBe(false)
    expect(el.getAttribute('role')).toBe('region')
    act(() => root?.unmount())
    host.remove()
    errors.mockRestore()
  })

  it('fits (scrollWidth === clientWidth): NOT in the tab order, role and name kept', () => {
    setFits()
    render(<Region />)
    expect(region().hasAttribute('tabindex')).toBe(false)
    expect(region().getAttribute('aria-label')).toBe('Income sources table')
  })

  it('overflows (scrollWidth > clientWidth): tabindex="0", role and name kept', () => {
    setOverflows()
    render(<Region />)
    expect(region().getAttribute('tabindex')).toBe('0')
    expect(region().getAttribute('aria-label')).toBe('Income sources table')
  })

  it('a resize flips it both ways without a re-render (ResizeObserver)', () => {
    setFits()
    render(<Region />)
    expect(region().hasAttribute('tabindex')).toBe(false)

    setOverflows()
    fireResize()
    expect(region().getAttribute('tabindex')).toBe('0')

    setFits()
    fireResize()
    expect(region().hasAttribute('tabindex')).toBe(false)
    expect(region().getAttribute('role')).toBe('region')
  })

  it('watches the region AND its table (the table can widen inside a box that does not)', () => {
    render(<Region />)
    const observed = RecordingResizeObserver.instances.flatMap((ro) => [...ro.targets])
    expect(observed).toContain(region())
    expect(observed).toContain(region().querySelector('table'))
  })

  it('a content change re-measures on the next render (rows added, then removed)', () => {
    setFits()
    const { rerender } = render(<Region rows={1} />)
    expect(region().hasAttribute('tabindex')).toBe(false)

    setOverflows()
    rerender(<Region rows={2} />)
    expect(region().getAttribute('tabindex')).toBe('0')

    setFits()
    rerender(<Region rows={1} />)
    expect(region().hasAttribute('tabindex')).toBe(false)
  })
})
