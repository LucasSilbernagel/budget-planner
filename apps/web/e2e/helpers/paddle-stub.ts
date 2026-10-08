/**
 * A fake Paddle.js for flow F10 (story 87.2, decision D2). No request reaches
 * Paddle: every browser request to `*.paddle.com` is answered here.
 *
 * What it fakes, and why exactly that (read from `@paddle/paddle-js` 1.6.4,
 * `dist/index.esm.js`, the version `apps/web/package.json` resolves):
 *
 *   - `initializePaddle({ token, environment })` injects ONE script,
 *     `https://cdn.paddle.com/paddle/v2/paddle.js` (Billing v1, the default
 *     version), waits for its `load` event, then reads `window.PaddleBillingV1`
 *     and calls `Environment.set(environment)` and, as `Initialized` is falsy,
 *     `Initialize({ token })`. A missing `window.PaddleBillingV1` rejects with
 *     "Paddle.js not available".
 *   - The app then calls only `PricePreview({ items })`
 *     (`lib/paddle/checkout.ts` `getLocalizedPlanPrices`, reading
 *     `data.details.lineItems[].price.id` and `.formattedTotals`) and
 *     `Checkout.open({ items, settings: { displayMode, variant, successUrl },
 *     customer? })` (`openPaddleCheckout`).
 *
 * `Checkout.open` records its argument and then does what a completed real
 * checkout does with a `successUrl`: navigates there. With NO `successUrl` it
 * stays put, as the real overlay does (it shows its own confirmation), so a
 * dropped `successUrl` never reaches `/welcome` (story 87.2 AC 3 (iii)).
 *
 * The stub reports every call through a binding the test exposes, so the
 * record survives the navigation `Checkout.open` starts.
 */
import type { Page } from '@playwright/test'

/** The one script `@paddle/paddle-js` 1.6.4 loads for Paddle Billing. */
const PADDLE_JS_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js'

/**
 * The stub's localized totals. Deliberately NOT the app's static fallback
 * labels (`€39/yr`, ...), so a label showing one of these proves the stub was
 * loaded and `PricePreview` answered.
 */
export const STUB_TOTALS = {
  monthly: '€5.99',
  annual: '€39.00',
  lifetime: '€99.00',
} as const

interface PaddleStubCall {
  method: string
  args: unknown[]
}

export interface PaddleStub {
  /** Every stub method call, in order. */
  calls: PaddleStubCall[]
  /** Every browser request to a `*.paddle.com` host, and how it was answered. */
  paddleRequests: Array<{ url: string; answer: 'stub' | 'aborted' }>
  /** The arguments of each `Checkout.open` call. */
  checkoutOpens(): Record<string, unknown>[]
}

const BINDING = '__paddleStubRecord'

/**
 * The fake script. `priceTotals` maps a price id to the localized total the
 * fake `PricePreview` reports for it.
 */
function stubScript(priceTotals: Record<string, string>): string {
  return `(() => {
  const totals = ${JSON.stringify(priceTotals)};
  const record = (method, args) => {
    const fn = window[${JSON.stringify(BINDING)}];
    return typeof fn === 'function' ? fn({ method, args }) : Promise.resolve();
  };
  const paddle = {
    Initialized: false,
    Environment: { set(environment) { void record('Environment.set', [environment]); } },
    Initialize(options) { paddle.Initialized = true; void record('Initialize', [options]); },
    Update(options) { void record('Update', [options]); },
    PricePreview(request) {
      void record('PricePreview', [request]);
      const lineItems = (request && request.items ? request.items : []).map((item) => {
        const total = totals[item.priceId];
        if (!total) throw new Error('paddle stub: unknown price ' + item.priceId);
        return { price: { id: item.priceId }, formattedTotals: { subtotal: total, tax: '€0.00', total } };
      });
      return Promise.resolve({ data: { details: { lineItems } } });
    },
    Checkout: {
      open(options) {
        const successUrl = options && options.settings ? options.settings.successUrl : undefined;
        // Record FIRST, then complete: the navigation would otherwise race the binding.
        record('Checkout.open', [options]).then(() => {
          if (successUrl) window.location.assign(successUrl);
        });
      },
    },
  };
  window.PaddleBillingV1 = paddle;
})();`
}

/**
 * Serve the fake Paddle.js for every `*.paddle.com` request this page makes
 * and record what the app calls. Call BEFORE the first `page.goto`.
 *
 * Any `*.paddle.com` request other than the script is ABORTED and recorded, so
 * the test can assert none was made (AC 4): with the real script gone nothing
 * else should ask Paddle for anything.
 *
 * ⚠️ `page.route` does not see requests a service worker makes, and the dev
 * server registers one: the spec must run with `serviceWorkers: 'block'`.
 */
export async function installPaddleStub(
  page: Page,
  priceTotals: Record<string, string>
): Promise<PaddleStub> {
  const stub: PaddleStub = {
    calls: [],
    paddleRequests: [],
    checkoutOpens: () =>
      stub.calls
        .filter((call) => call.method === 'Checkout.open')
        .map((call) => (call.args[0] ?? {}) as Record<string, unknown>),
  }
  await page.exposeBinding(BINDING, (_source, call: PaddleStubCall) => {
    stub.calls.push(call)
  })
  await page.route(/^https?:\/\/([a-z0-9-]+\.)*paddle\.com(\/|$)/i, async (route) => {
    const url = route.request().url()
    if (url === PADDLE_JS_URL) {
      stub.paddleRequests.push({ url, answer: 'stub' })
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: stubScript(priceTotals),
      })
      return
    }
    stub.paddleRequests.push({ url, answer: 'aborted' })
    await route.abort('blockedbyclient')
  })
  return stub
}
