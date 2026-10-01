// @vitest-environment node
/**
 * What the app's own server SENDS: response headers and static assets
 * (story 84.4, FR137).
 *
 * Replaces `e2e/security-headers.spec.ts`, `favicon.spec.ts`, the asset half
 * of `page-metadata.spec.ts` (robots.txt, sitemap.xml) and `pwa.spec.ts`'s
 * manifest group. Every claim here is about the HTTP response, so it needs a
 * real server (`src/test/served-app.ts`), not a browser.
 *
 * What moved out of reach (story 84.4 D2, named losses): the browser
 * ENFORCING the policy (`securitypolicyviolation` events). The policy itself,
 * and that every inline script the server sends is authorized by it, are
 * pinned here. The header FUNCTION is unit-tested in
 * `server/middleware/__tests__/security-headers.test.ts`; this file is what
 * proves `start.ts` actually applies it to a served page.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  SERVED_APP_TIMEOUT_MS,
  SERVED_TEST_TIMEOUT_MS,
  type ServedApp,
  headOf,
  header,
  startServedApp,
} from '../test/served-app'

vi.setConfig({ testTimeout: SERVED_TEST_TIMEOUT_MS })

let app: ServedApp

beforeAll(async () => {
  app = await startServedApp()
}, SERVED_APP_TIMEOUT_MS)

afterAll(async () => {
  await app?.close()
})

function nonceFromCsp(csp: string): string | undefined {
  return csp.match(/'nonce-([^']+)'/)?.[1]
}

function scriptSrc(csp: string): string {
  const directive = csp.split(';').find((d) => d.trim().startsWith('script-src '))
  if (!directive) throw new Error(`no script-src in: ${csp}`)
  return directive.trim()
}

function metaNonce(html: string): string | undefined {
  return html.match(/<meta property="csp-nonce" content="([^"]*)"/)?.[1]
}

describe('the document response headers (was e2e security-headers AC-1)', () => {
  it('carries a strict Content-Security-Policy and the hardening headers', async () => {
    const response = await app.get('/')
    expect(response.status).toBe(200)

    const csp = header(response, 'content-security-policy')
    expect(csp, 'CSP header present on the document response').toBeTruthy()
    const policy = csp as string

    expect(policy).toMatch(/script-src [^;]*'nonce-[^']+'/)
    expect(policy).toMatch(/script-src [^;]*'sha256-[^']+'/)
    expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/)
    expect(policy).toContain(`frame-ancestors 'none'`)
    expect(policy).toContain(`object-src 'none'`)
    expect(policy).toContain(`base-uri 'self'`)
    expect(policy).toContain(`default-src 'self'`)

    expect(header(response, 'referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(header(response, 'permissions-policy')).toContain('payment=()')
    expect(header(response, 'x-content-type-options')).toBe('nosniff')
    expect(header(response, 'x-frame-options')).toBe('DENY')
    // HSTS is gated on confirmed HTTPS: absent over this plain-HTTP server.
    expect(header(response, 'strict-transport-security')).toBeUndefined()
  })

  it('mints a nonce per request, and each document carries its own request’s nonce', async () => {
    const first = await app.get('/')
    const firstNonce = nonceFromCsp(header(first, 'content-security-policy') ?? '')
    expect(firstNonce, 'header carries a nonce').toBeTruthy()
    expect(metaNonce(first.body)).toBe(firstNonce)

    const second = await app.get('/')
    const secondNonce = nonceFromCsp(header(second, 'content-security-policy') ?? '')
    expect(secondNonce).toBeTruthy()
    expect(secondNonce).not.toBe(firstNonce)
    // The rendered nonce must follow the header, not stay frozen (a memoized
    // getRouter() would rotate the header and block every inline script).
    expect(metaNonce(second.body)).toBe(secondNonce)
  })

  /**
   * Was e2e "a no-flash bootstrap executes under the CSP". The browser half
   * (it RUNS) is the named loss; what the server controls is that no inline
   * script it sends would be blocked: each carries the request's nonce, or the
   * sha256 of its exact text is listed in `script-src`.
   *
   * Checked on more than `/` (84.4 review): a route-level `head().scripts`
   * bootstrap on another route would otherwise ship unauthorized and green.
   */
  for (const path of ['/', '/income', '/docs/getting-started']) {
    it(`authorizes every inline <script> it serves on ${path}, by nonce or by exact hash`, async () => {
      const response = await app.get(path)
      expect(response.status, `${path} status`).toBe(200)
      const policy = scriptSrc(header(response, 'content-security-policy') ?? '')
      const nonce = nonceFromCsp(policy)

      const inline = [...response.body.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(
        ([, attributes = '']) => !/\ssrc=/.test(attributes)
      )
      // Anti-vacuity: the two pre-paint bootstraps are hash-authorized inline
      // scripts in <head>, so a parse that found none would be blind.
      const hashed = inline.filter(([, attributes = '']) => !/\snonce=/.test(attributes))
      expect(hashed.length, 'expected the hash-authorized bootstraps').toBeGreaterThanOrEqual(2)

      for (const [tag, attributes = '', text = ''] of inline) {
        const scriptNonce = attributes.match(/\snonce="([^"]*)"/)?.[1]
        if (scriptNonce !== undefined) {
          expect(scriptNonce, `nonce mismatch on ${tag.slice(0, 80)}`).toBe(nonce)
          continue
        }
        const hash = `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
        expect(policy, `inline script not authorized: ${tag.slice(0, 120)}`).toContain(hash)
      }
    })
  }
})

describe('robots.txt and sitemap.xml (was e2e page-metadata)', () => {
  it('serves robots.txt from the app origin', async () => {
    const response = await app.get('/robots.txt')
    expect(response.status).toBe(200)
    expect(response.body).toContain('User-agent: *')
    expect(response.body).toContain('Disallow: /api/')
    // Anchored to a line: the file's comments also say "Sitemap:".
    expect(response.body).toMatch(
      /^\s*sitemap\s*:\s*https:\/\/www\.longhandbudget\.com\/sitemap\.xml\s*$/im
    )
    expect(response.body).toMatch(/^\s*disallow\s*:\s*\/welcome\s*$/im)
  })

  it('serves sitemap.xml from the app origin', async () => {
    const response = await app.get('/sitemap.xml')
    expect(response.status).toBe(200)
    expect(response.body).toContain('<urlset')
    expect(response.body).toContain('<loc>https://www.longhandbudget.com/pricing</loc>')
  })
})

describe('favicons (was e2e favicon)', () => {
  it('links the favicon set from the served head', async () => {
    const head = headOf((await app.get('/')).body)
    expect(head).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/)
    expect(head.match(/<link rel="icon"[^>]*href="\/favicon\.ico"/g)).toHaveLength(1)
    expect(head).toMatch(/<link rel="icon"[^>]*sizes="16x16" href="\/favicon-16\.png"/)
    expect(head).toMatch(/<link rel="icon"[^>]*sizes="32x32" href="\/favicon-32\.png"/)
    expect(head).toMatch(/<link rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/)
  })

  it('answers every linked icon with an image', async () => {
    const head = headOf((await app.get('/')).body)
    const hrefs = [
      ...head.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g),
    ].map(([, href]) => href as string)

    // ico + svg + 16 + 32 + apple-touch.
    expect(hrefs.length).toBeGreaterThanOrEqual(5)
    for (const href of hrefs) {
      const response = await app.get(href)
      expect(response.status, `${href} should return a 2xx`).toBeGreaterThanOrEqual(200)
      expect(response.status, `${href} should return a 2xx`).toBeLessThan(300)
      expect(header(response, 'content-type') ?? '', `${href} should be an image`).toMatch(
        /^image\//
      )
    }
  })
})

describe('the web app manifest (was e2e pwa (manifest))', () => {
  it('links the manifest and theme-color from the served head', async () => {
    const head = headOf((await app.get('/')).body)
    expect(head).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/)
    expect(head).toMatch(/<meta name="theme-color" content="#16a34a"/)
  })

  it('serves a valid, installable manifest', async () => {
    const response = await app.get('/manifest.webmanifest')
    expect(response.status).toBe(200)
    // The dev plugin may say application/json; production's type is pinned by
    // `server/__tests__/node-adapter.test.ts`.
    expect(header(response, 'content-type') ?? '').toMatch(
      /application\/manifest\+json|application\/json/
    )
    const manifest = JSON.parse(response.body) as {
      name?: string
      display?: string
      start_url?: string
      icons?: { sizes: string }[]
    }
    expect(manifest.name).toBeTruthy()
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  it('serves the install icons as PNGs', async () => {
    for (const href of ['/pwa-192.png', '/pwa-512.png']) {
      const response = await app.get(href)
      expect(response.status, `${href} should return 200`).toBe(200)
      expect(header(response, 'content-type') ?? '', `${href} should be a PNG`).toMatch(
        /^image\/png/
      )
    }
  })
})
