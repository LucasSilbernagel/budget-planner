/** jsdom has no layout (widths are always 0); only `role="region"` elements report the stubbed widths. */

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

export function setRegionOverflows(): void {
  widths.scroll = 657
  widths.client = 656
}
