/**
 * Stubbed widths for table scroll regions (story 93.1).
 *
 * jsdom computes no layout: `scrollWidth` and `clientWidth` are always 0, so
 * every `TableScrollRegion` measures "fits" and drops its `tabindex`. A test
 * that wants to see the overflow rule calls {@link stubRegionWidths} and sets
 * the widths it needs; only elements with `role="region"` report them, every
 * other element keeps jsdom's 0. {@link restoreRegionWidths} undoes it.
 */

const widths = { scroll: 0, client: 0 }

/** HTMLElement.prototype's OWN descriptors (jsdom defines these on Element). */
const originals = {
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
}

export function stubRegionWidths(): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('role') === 'region' ? widths.scroll : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('role') === 'region' ? widths.client : 0
    },
  })
}

export function restoreRegionWidths(): void {
  widths.scroll = 0
  widths.client = 0
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
}

/** Content exactly as wide as the box: fits (the zero-slack case on CI's font). */
export function setRegionFits(): void {
  widths.scroll = 656
  widths.client = 656
}

/** Content 1 px wider than the box: scrolls. */
export function setRegionOverflows(): void {
  widths.scroll = 657
  widths.client = 656
}
