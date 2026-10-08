// A fake Paddle.js: every browser request to *.paddle.com is answered here.
// Checkout.open navigates to successUrl as a real checkout does; without one it stays put.
import type { Page } from '@playwright/test'

const PADDLE_JS_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js'

/** Deliberately not the app's fallback labels, so seeing one proves the stub's PricePreview answered. */
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
  calls: PaddleStubCall[]
  paddleRequests: Array<{ url: string; answer: 'stub' | 'aborted' }>
  checkoutOpens(): Record<string, unknown>[]
}

const BINDING = '__paddleStubRecord'

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

// Call before the first goto. page.route doesn't see service-worker requests, so the
// spec must run with `serviceWorkers: 'block'`.
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
