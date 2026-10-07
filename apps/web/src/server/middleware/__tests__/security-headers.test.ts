/**
 * Security headers tests (Story 5.8 — AC-14; extended by story sec-1)
 */

import { createHash } from 'node:crypto'
import { getPaddleConfig, resetConfig } from '@budget-planner/config'
import { afterEach, describe, expect, it } from 'vitest'
import { NO_FLASH_PLANNER_SCRIPT } from '../../../lib/nav/no-flash-planner-visibility-script'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../../../lib/overview/no-flash-account-notice-script'
import { NO_FLASH_OVERVIEW_DATA_SCRIPT } from '../../../lib/overview/no-flash-overview-data-script'
import { PADDLE_LOADER_STYLE_TEXT } from '../../../lib/paddle/paddle-js-internals'
import {
  ACCOUNT_NOTICE_SCRIPT_CSP_HASH,
  OVERVIEW_DATA_SCRIPT_CSP_HASH,
  PADDLE_LOADER_STYLE_CSP_HASH,
  PLANNER_SCRIPT_CSP_HASH,
  REFERRER_POLICY,
  STRICT_TRANSPORT_SECURITY,
  applyHeadersToNextResult,
  applySecurityHeaders,
  buildContentSecurityPolicy,
  buildPermissionsPolicy,
  isCanonicalHttpsRequest,
  isConfirmedHttps,
  paddleCheckoutFrameOrigins,
  paddleEnvironmentForCsp,
  paddleEnvironmentFromProcessEnv,
  paddleStyleHosts,
} from '../security-headers'

/**
 * The hash Chrome printed on the LIVE site when it refused Paddle.js's overlay spinner
 * <style> (story sec-4, M2). Typed here ON PURPOSE, as the one external witness: the
 * constant under test is derived from a committed copy of the text, and this proves the
 * copy is byte-exact.
 */
const CHROME_REPORTED_LOADER_STYLE_HASH = 'sha256-DZJGI9GW1KarnkjWFGQEtAWrfY4TQZwE9gIsAtq6sTk='

const TEST_NONCE = 'dGVzdC1ub25jZS0xMjM='

/**
 * Parse a CSP header string into a directive-name → source-list map.
 *
 * ⚠️ THROWS on a repeated directive name, and that is load-bearing (story 39.2 review).
 * Browsers enforce the FIRST occurrence of a directive and ignore later duplicates; a
 * naive last-wins map does the opposite. So a policy like
 * `script-src <loose>; …; script-src <strict>` would be ENFORCED loose while every
 * `toBe` assertion in this file read the strict copy and passed. Rather than silently
 * pick a winner, refuse to parse — a duplicated directive is never intentional here.
 */
function parseCsp(csp: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const part of csp.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const spaceIdx = trimmed.indexOf(' ')
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
    if (Object.hasOwn(map, name)) {
      throw new Error(
        `parseCsp: duplicate directive '${name}'. Browsers enforce the FIRST occurrence; every assertion in this file would otherwise read the LAST and pass on a policy that ships loose. Fix the policy, not this helper.`
      )
    }
    map[name] = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)
  }
  return map
}

const baseOpts = {
  isDev: false,
  isHttps: true,
  nonce: TEST_NONCE,
  paddleEnvironment: 'production' as const,
}

describe('applySecurityHeaders', () => {
  it('sets the baseline legacy security headers on a response', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, baseOpts)

    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-XSS-Protection')).toBe('1; mode=block')
  })

  it('does NOT set permissive CORS outside development', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, baseOpts)
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('sets dev-only permissive CORS in development', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, {
      isDev: true,
      isHttps: false,
      nonce: TEST_NONCE,
      paddleEnvironment: 'production',
    })
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*')
    // Security headers are still present in dev.
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('Content-Security-Policy')).toBe(
      buildContentSecurityPolicy(TEST_NONCE, 'production', true)
    )
  })

  describe('Content-Security-Policy (sec-1 AC-1)', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, baseOpts)
    const csp = headers.get('Content-Security-Policy')

    it('is present on every response and injects the request nonce', () => {
      expect(csp).toBe(buildContentSecurityPolicy(TEST_NONCE, 'production', false))
      expect(csp).toBeTruthy()
    })

    it('locks the baseline: default-src self, object-src none, frame-ancestors none, base-uri/form-action self', () => {
      const d = parseCsp(csp ?? '')
      expect(d['default-src']).toBe(`'self'`)
      expect(d['object-src']).toBe(`'none'`)
      expect(d['frame-ancestors']).toBe(`'none'`)
      expect(d['base-uri']).toBe(`'self'`)
      expect(d['form-action']).toBe(`'self'`)
      // worker-src MUST be explicit 'self': it falls back to child-src (set for
      // Paddle frames, no 'self'), not default-src, so the same-origin PWA
      // service worker would otherwise be blocked (story 7-1).
      expect(d['worker-src']).toBe(`'self'`)
      expect(d['manifest-src']).toBe(`'self'`)
    })

    it('allows exactly the real script origins (self, nonce, bootstrap hashes, Paddle, counter.dev) and no unsafe-inline for scripts', () => {
      const d = parseCsp(csp ?? '')
      expect(d['script-src']).toContain(`'self'`)
      expect(d['script-src']).toContain(`'nonce-${TEST_NONCE}'`)
      expect(d['script-src']).toContain('https://cdn.paddle.com')
      expect(d['script-src']).toContain('https://cdn.counter.dev')
      expect(d['script-src']).not.toContain('ethicalads')
      expect(d['script-src']).not.toContain(`'unsafe-inline'`)
    })

    // Story 39.2 review finding (all three review layers, independently). The
    // `script-src` pin below is necessary and NOT sufficient: `script-src-elem`
    // OVERRIDES `script-src` for every <script> ELEMENT load, so adding
    // `script-src-elem 'self' 'unsafe-inline' https://anything` fully reopens inline
    // element scripts while leaving `script-src` — and therefore that pin — untouched.
    // Measured: with that directive added, the entire suite passed 26/26, and the e2e
    // guards missed it too (their regexes need a literal `script-src ` with a trailing
    // space, which `script-src-elem` does not match).
    //
    // `script-src-elem` is also the exact directive named in the dev-console error
    // story 39.2 investigated, which makes "just add a script-src-elem exception" the
    // most probable dev-convenience edit anyone will reach for here.
    //
    // Pinned as a SET, not an ordered list: CSP attaches no meaning to directive order,
    // so reordering must not fail, while adding or removing a directive must.
    it('closes the DIRECTIVE SET, so no new script directive can be added alongside script-src (39.2 review)', () => {
      const names = Object.keys(parseCsp(csp ?? '')).sort()
      expect(names).toEqual(
        [
          'base-uri',
          'child-src',
          'connect-src',
          'default-src',
          'font-src',
          'form-action',
          'frame-ancestors',
          'frame-src',
          'img-src',
          'manifest-src',
          'object-src',
          'script-src',
          'style-src',
          // Story 89.1 (D2 (c′)): added deliberately. `style-src-elem` OVERRIDES
          // `style-src` for <style>/stylesheet loads, so its value is pinned
          // exactly below, the same discipline as `script-src`.
          'style-src-attr',
          'style-src-elem',
          'worker-src',
        ].sort()
      )
    })

    // Story 39.2 review finding. `child-src` was the ONE directive with no assertion of
    // any kind — 14 emitted, 13 pinned, this one mentioned only in a comment. A new
    // frame/worker host could be added to it unnoticed. The set pin above proves the
    // NAME is present; only this proves its VALUE.
    it('pins child-src (39.2 review — it was the one directive asserted nowhere)', () => {
      const d = parseCsp(csp ?? '')
      expect(d['child-src']).toBe('https://*.paddle.com')
    })

    // Story 39.2 review finding. The nonce is format-checked before interpolation
    // (`security-headers.ts:94`); these two hashes are NOT. Because the pin below is
    // built from the same exported constants, it is tautological over their CONTENT:
    // a constant carrying `sha256-<real>' https://evil.example 'sha256-<real>` would
    // authorize an extra host while the pin passes (same string on both sides) and both
    // drift guards pass (their `toContain` substring is still present). This is the one
    // assertion here computed independently of what the constants happen to contain.
    it('constrains every CSP hash constant to a bare sha256 token (39.2 review)', () => {
      const bareSha256 = /^sha256-[A-Za-z0-9+/]{43}=$/
      expect(PLANNER_SCRIPT_CSP_HASH).toMatch(bareSha256)
      expect(ACCOUNT_NOTICE_SCRIPT_CSP_HASH).toMatch(bareSha256)
      expect(OVERVIEW_DATA_SCRIPT_CSP_HASH).toMatch(bareSha256)
      expect(PADDLE_LOADER_STYLE_CSP_HASH).toMatch(bareSha256)
    })

    // Story sec-4, D2 (a). Guards a typo or an edited copy of the spinner text; it CANNOT
    // see Paddle changing its own text (the weekly paddle-drift.yml workflow does).
    it("derives the Paddle spinner <style> hash from the committed text, equal to Chrome's live report (sec-4 D2)", () => {
      expect(PADDLE_LOADER_STYLE_TEXT).toHaveLength(270)
      expect(PADDLE_LOADER_STYLE_CSP_HASH).toBe(
        `sha256-${createHash('sha256').update(PADDLE_LOADER_STYLE_TEXT, 'utf8').digest('base64')}`
      )
      expect(PADDLE_LOADER_STYLE_CSP_HASH).toBe(CHROME_REPORTED_LOADER_STYLE_HASH)
    })

    // Story 39.2, AC-5. Before this, `script-src` was asserted only with
    // `toContain` / `not.toContain`, so ADDING a source could not fail it: appending
    // `'unsafe-eval'` to the policy leaves the assertions above green (measured — the
    // arm is recorded in the story). The only loosening they caught was the literal
    // string `'unsafe-inline'`.
    //
    // Built from the three EXPORTED hash constants, never from pasted base64, so it
    // tracks the bootstraps instead of stranding when one is edited. Division of
    // labour: the drift guards below own "the hash matches the script"; the format
    // guard owns "the hash is a bare sha256 and smuggles nothing"; this one owns
    // "the source LIST is exactly this and nothing else".
    //
    // ⚠️ SCOPE: this pins ONE directive. It is the "closes the DIRECTIVE SET" test
    // above that stops a NEW script directive (`script-src-elem`, which overrides this
    // one for element loads) being added alongside it. Neither is sufficient alone — the
    // first version of this test shipped without the set pin and a
    // `script-src-elem 'unsafe-inline'` addition passed the whole suite.
    //
    // Deliberately brittle: it fails when any script source is added or removed. That
    // is the intent — adding one is a security decision, and this is where it gets
    // made rather than noticed later. (Note `https://cdn.paddle.com` is ALREADY
    // present, so story 5-3 turning Paddle billing on does not by itself trip this.)
    //
    // Story 55.1 added the THIRD hash (`ACCOUNT_NOTICE_SCRIPT_CSP_HASH`) and this
    // test failed until it was listed here — which is the test working as designed,
    // not an obstacle: a new inline script is exactly the "security decision" the
    // comment above says must be made at this line. Story 117.2 made the same
    // decision for the Overview pending-block bootstrap (`OVERVIEW_DATA_SCRIPT_CSP_HASH`).
    it('pins the ENTIRE production script-src, so no source can be added unnoticed (39.2 AC-5)', () => {
      const d = parseCsp(csp ?? '')
      expect(d['script-src']).toBe(
        `'self' 'nonce-${TEST_NONCE}' '${PLANNER_SCRIPT_CSP_HASH}' '${ACCOUNT_NOTICE_SCRIPT_CSP_HASH}' '${OVERVIEW_DATA_SCRIPT_CSP_HASH}' https://cdn.paddle.com https://cdn.counter.dev`
      )
    })

    // Story 89.1 (D2 (c′), Lucas 2026-10-02). MEASURED on the production build
    // (`89-1-evidence/violations.md`): the app needs no inline style; Paddle.js's
    // checkout overlay needs inline style ATTRIBUTES (its iframe collapses to a
    // static 300×150 without them) and its stylesheet from the Paddle CDN. So
    // attributes keep 'unsafe-inline', and <style> elements / stylesheets are
    // locked to 'self' + the production Paddle CDN. The base `style-src` is
    // 'self' 'unsafe-inline' as a LEGACY FALLBACK only (89.1 review, Lucas
    // 2026-10-02): CSP3 §6.8.3/§6.8.4 run it only when the sub-directive is absent.
    // All three pinned EXACTLY: adding a source to any of them is a security
    // decision made here.
    //
    // Story sec-4 (AC-3) adds exactly ONE source to `style-src-elem`: the hash of
    // Paddle.js's overlay spinner <style>. The base `style-src` is UNCHANGED: a hash
    // there would switch its 'unsafe-inline' off (CSP3 §6.7.3.2).
    it('splits styles: elements locked to self + the Paddle spinner hash + the production Paddle CDN, attributes inline (89.1 D2, sec-4)', () => {
      const d = parseCsp(csp ?? '')
      expect(d['style-src']).toBe(`'self' 'unsafe-inline' https://cdn.paddle.com`)
      expect(d['style-src-elem']).toBe(
        `'self' '${CHROME_REPORTED_LOADER_STYLE_HASH}' https://cdn.paddle.com`
      )
      expect(d['style-src-attr']).toBe(`'unsafe-inline'`)
    })

    // The <style>-element restriction lives in `style-src-elem` ALONE now: the base
    // `style-src` carries 'unsafe-inline', so a policy that dropped (or emptied)
    // `style-src-elem` would silently hand <style> elements to the fallback and
    // REOPEN injected <style> in every CSP3 browser. Pinned in both environments.
    // Story sec-4: the ONE hash allowed is the Paddle spinner's, exactly once.
    it.each(['production', 'sandbox'] as const)(
      "in %s, <style> elements are refused: style-src-elem is present, has no 'unsafe-inline', nonce, wildcard or other hash (89.1 review, sec-4)",
      (env) => {
        const d = parseCsp(buildContentSecurityPolicy(TEST_NONCE, env, false))
        const elem = d['style-src-elem']
        expect(elem).toBeDefined()
        const hashes = (elem ?? '').match(/'sha(256|384|512)-[^']*'/g) ?? []
        expect(hashes).toEqual([`'${PADDLE_LOADER_STYLE_CSP_HASH}'`])
        const withoutTheLoaderHash = (elem ?? '').replace(`'${PADDLE_LOADER_STYLE_CSP_HASH}'`, '')
        expect(withoutTheLoaderHash).not.toMatch(
          /'unsafe-inline'|'nonce-|'sha(256|384|512)-|(^|\s)\*(\s|$)|'unsafe-hashes'/
        )
        // A hash must never reach the base fallback (it would disable its 'unsafe-inline').
        expect(d['style-src']).not.toMatch(/'sha(256|384|512)-|'nonce-/)
        // The attribute directive must also be present, or attributes fall back to
        // the base 'unsafe-inline' (harmless today, but no longer a deliberate pin).
        expect(d['style-src-attr']).toBe(`'unsafe-inline'`)
      }
    )

    it('never grants the SANDBOX Paddle CDN to a production policy (89.1 D2)', () => {
      expect(csp ?? '').not.toContain('sandbox-cdn.paddle.com')
    })

    it('allows the real connect / frame / img / font origins', () => {
      const d = parseCsp(csp ?? '')
      expect(d['connect-src']).toBe(
        `'self' https://submit-form.com https://counter.dev https://*.counter.dev https://*.paddle.com`
      )
      expect(d['frame-src']).toBe('https://*.paddle.com')
      expect(d['img-src']).toBe(`'self' data:`)
      expect(d['font-src']).toBe(`'self' data:`)
      // Story 25-1 removed all advertising — no ad-network origin survives anywhere.
      expect(csp ?? '').not.toContain('ethicalads')
    })

    // Story 61.1 removed what used to be the FIRST drift guard here, for the
    // no-flash THEME bootstrap: that script is deleted and the theme is now pure
    // CSS (`prefers-color-scheme`), so there is nothing left to authorize. The
    // absence guard below replaces it — a retired hash is silent, not red.

    // Story 35.2 — an inline bootstrap authorized by HASH. Drift guard, recomputed
    // independently: a future edit to NO_FLASH_PLANNER_SCRIPT that forgets the
    // policy blocks the script, and a blocked script means the Retirement entry
    // paints on the first frame for a user who turned it off.
    it('pins the sha256 of the EXACT inline planner-visibility script in script-src (35.2 AC-10)', () => {
      const expectedHash = `sha256-${createHash('sha256')
        .update(NO_FLASH_PLANNER_SCRIPT, 'utf8')
        .digest('base64')}`
      const d = parseCsp(csp ?? '')
      expect(d['script-src']).toContain(`'${expectedHash}'`)
    })

    // Story 55.1 — the other inline bootstrap. Same drift guard, recomputed
    // independently: a future edit to NO_FLASH_ACCOUNT_NOTICE_SCRIPT that forgets
    // the policy blocks the script, and a blocked script means the dismissed
    // "No account needed" box paints on the first frame for a user who closed it.
    it('pins the sha256 of the EXACT inline account-notice script in script-src (55.1 AC-4)', () => {
      const expectedHash = `sha256-${createHash('sha256')
        .update(NO_FLASH_ACCOUNT_NOTICE_SCRIPT, 'utf8')
        .digest('base64')}`
      const d = parseCsp(csp ?? '')
      expect(d['script-src']).toContain(`'${expectedHash}'`)
    })

    // Story 117.2 — the Overview pending-block bootstrap. Same drift guard,
    // recomputed independently: a blocked script means a returning user's
    // Overview jumps on load again (FR185), in production only.
    it('pins the sha256 of the EXACT inline Overview pending-block script in script-src (117.2)', () => {
      const expectedHash = `sha256-${createHash('sha256')
        .update(NO_FLASH_OVERVIEW_DATA_SCRIPT, 'utf8')
        .digest('base64')}`
      const d = parseCsp(csp ?? '')
      expect(d['script-src']).toContain(`'${expectedHash}'`)
    })

    // Anti-vacuity: the hashes must be DIFFERENT sources, not one hash asserted
    // twice. If two scripts were ever collapsed into one constant, their guards
    // above would both pass while only one bootstrap actually shipped. (Story
    // 61.1 took this from three to two with the theme bootstrap; story 117.2
    // back to three with the Overview pending-block bootstrap.)
    it('authorizes three distinct inline script hashes', () => {
      const hashes = [
        NO_FLASH_PLANNER_SCRIPT,
        NO_FLASH_ACCOUNT_NOTICE_SCRIPT,
        NO_FLASH_OVERVIEW_DATA_SCRIPT,
      ].map((script) => createHash('sha256').update(script, 'utf8').digest('base64'))
      expect(new Set(hashes).size).toBe(3)
    })

    /**
     * Story 61.1, AC-5 — the RETIRED theme-bootstrap hash must be gone.
     *
     * ⚠️ This is the one assertion in this file that exists because its subject
     * does NOT exist. Deleting a script and leaving its hash in `script-src`
     * produces no error anywhere: the policy simply authorizes an inline script
     * nobody ships, which is a standing permission for anyone who can reproduce
     * that exact body. Nothing else here would notice — the exact-pin test above
     * would have been "fixed" by pasting the stale hash back in.
     *
     * The hash is a LITERAL because its source is deleted; it cannot be
     * recomputed from a constant that no longer exists. It is the sha256 of the
     * script body as it shipped at `40cbb08`, verified against that git blob.
     */
    it('no longer authorizes the RETIRED theme bootstrap hash (61.1, AC-5)', () => {
      const RETIRED_THEME_HASH = 'sha256-DzWHJTkK2Y+TrJj6ZKlur4j1LNH8wBr/KvpudOrBoWY='
      // Asserted on the RAW header, not the parsed directive: a stale hash that
      // somehow landed in a different directive is just as wrong, and this is the
      // strictly broader check.
      expect(csp ?? '').not.toContain(RETIRED_THEME_HASH)
    })
  })

  describe('Paddle stylesheet host by Paddle environment (story 89.1 D2)', () => {
    it('a SANDBOX policy adds the sandbox CDN to style-src-elem, and changes nothing else', () => {
      const sandbox = parseCsp(buildContentSecurityPolicy(TEST_NONCE, 'sandbox', false))
      const production = parseCsp(buildContentSecurityPolicy(TEST_NONCE, 'production', false))
      expect(sandbox['style-src-elem']).toBe(
        `'self' '${CHROME_REPORTED_LOADER_STYLE_HASH}' https://cdn.paddle.com https://sandbox-cdn.paddle.com`
      )
      expect(production['style-src-elem']).toBe(
        `'self' '${CHROME_REPORTED_LOADER_STYLE_HASH}' https://cdn.paddle.com`
      )
      // The legacy fallback and the attribute directive, pinned in BOTH environments.
      // The legacy fallback carries the same Paddle hosts (89.1 review, Lucas).
      expect(sandbox['style-src']).toBe(
        `'self' 'unsafe-inline' https://cdn.paddle.com https://sandbox-cdn.paddle.com`
      )
      expect(production['style-src']).toBe(`'self' 'unsafe-inline' https://cdn.paddle.com`)
      for (const d of [sandbox, production]) {
        expect(d['style-src-attr']).toBe(`'unsafe-inline'`)
      }
      // Every other directive is identical between the two branches.
      const { 'style-src-elem': _s, 'style-src': _sb, ...sandboxRest } = sandbox
      const { 'style-src-elem': _p, 'style-src': _pb, ...productionRest } = production
      expect(sandboxRest).toEqual(productionRest)
    })

    it('applySecurityHeaders passes the environment through to the header', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, { ...baseOpts, paddleEnvironment: 'sandbox' })
      expect(headers.get('Content-Security-Policy')).toBe(
        buildContentSecurityPolicy(TEST_NONCE, 'sandbox', false)
      )
    })

    it('paddleStyleHosts never lists the sandbox CDN for production', () => {
      expect(paddleStyleHosts('production')).toEqual(['https://cdn.paddle.com'])
      expect(paddleStyleHosts('sandbox')).toEqual([
        'https://cdn.paddle.com',
        'https://sandbox-cdn.paddle.com',
      ])
    })

    describe('paddleEnvironmentForCsp (mirrors /api/paddle/checkout-config)', () => {
      it('is sandbox ONLY when PADDLE_ENVIRONMENT is explicitly set and the config says sandbox', () => {
        expect(paddleEnvironmentForCsp('sandbox', () => 'sandbox')).toBe('sandbox')
      })

      it('is production when the config says production', () => {
        expect(paddleEnvironmentForCsp('production', () => 'production')).toBe('production')
      })

      it('is production when PADDLE_ENVIRONMENT is unset or empty, even though the schema DEFAULTS to sandbox', () => {
        // The resolver would answer 'sandbox' (the schema default); it must not be asked.
        const resolver = () => 'sandbox'
        expect(paddleEnvironmentForCsp(undefined, resolver)).toBe('production')
        expect(paddleEnvironmentForCsp('', resolver)).toBe('production')
      })

      it('is production when the config fails to load (never a 500 from the CSP)', () => {
        expect(
          paddleEnvironmentForCsp('sandbox', () => {
            throw new Error('invalid env')
          })
        ).toBe('production')
      })
    })
  })

  // 89.1 review (Lucas 2026-10-02, option (a)): Vite's error-overlay <style> and HMR
  // <style> need inline <style> in DEV. A nonce does not work (Vite reads the meta's
  // `.nonce`, TanStack writes `content`; measured). A PRODUCTION policy never gets it.
  //
  // Story sec-4 (AC-3): the DEV list carries NO hash. A hash there would switch its
  // 'unsafe-inline' off (CSP3 §6.7.3.2) and re-break Vite's <style> elements.
  describe("style-src-elem 'unsafe-inline': dev only (89.1 review)", () => {
    it.each(['production', 'sandbox'] as const)(
      "in %s, the DEV policy has 'unsafe-inline' and NO hash in style-src-elem (sec-4)",
      (env) => {
        const dev = parseCsp(buildContentSecurityPolicy(TEST_NONCE, env, true))
        const prod = parseCsp(buildContentSecurityPolicy(TEST_NONCE, env, false))
        expect(dev['style-src-elem']).toBe(
          `'self' 'unsafe-inline' ${paddleStyleHosts(env).join(' ')}`
        )
        expect(dev['style-src-elem']).not.toMatch(/'sha(256|384|512)-|'nonce-/)
        expect(prod['style-src-elem']).toBe(
          `'self' '${PADDLE_LOADER_STYLE_CSP_HASH}' ${paddleStyleHosts(env).join(' ')}`
        )
        // Nothing else differs between dev and production.
        const { 'style-src-elem': _d, ...devRest } = dev
        const { 'style-src-elem': _p, ...prodRest } = prod
        expect(devRest).toEqual(prodRest)
      }
    )

    it('applySecurityHeaders gives inline <style> to development only', () => {
      const devHeaders = new Headers()
      applySecurityHeaders(devHeaders, { ...baseOpts, isDev: true })
      expect(parseCsp(devHeaders.get('Content-Security-Policy') ?? '')['style-src-elem']).toBe(
        `'self' 'unsafe-inline' https://cdn.paddle.com`
      )
      const prodHeaders = new Headers()
      applySecurityHeaders(prodHeaders, baseOpts)
      expect(parseCsp(prodHeaders.get('Content-Security-Policy') ?? '')['style-src-elem']).toBe(
        `'self' '${CHROME_REPORTED_LOADER_STYLE_HASH}' https://cdn.paddle.com`
      )
    })
  })

  // 89.1 review: the start.ts wiring, against the REAL config schema (no stub
  // resolver). The schema DEFAULTS an unset PADDLE_ENVIRONMENT to 'sandbox', so the
  // unset case is the one that proves the explicit-env gate is actually wired.
  describe('paddleEnvironmentFromProcessEnv (the start.ts wiring, real config)', () => {
    const saved = process.env['PADDLE_ENVIRONMENT']
    const setEnv = (v: string | undefined) => {
      // Not `= undefined`: process.env coerces that to the STRING 'undefined'.
      if (v === undefined) Reflect.deleteProperty(process.env, 'PADDLE_ENVIRONMENT')
      else process.env['PADDLE_ENVIRONMENT'] = v
      resetConfig()
    }
    afterEach(() => setEnv(saved))

    it('unset → production, although getPaddleConfig() itself answers sandbox', () => {
      setEnv(undefined)
      expect(getPaddleConfig().environment).toBe('sandbox')
      resetConfig()
      expect(paddleEnvironmentFromProcessEnv()).toBe('production')
    })

    it.each([
      ['sandbox', 'sandbox'],
      ['production', 'production'],
      ['', 'production'],
      ['Sandbox', 'production'],
      [' sandbox', 'production'],
    ] as const)('PADDLE_ENVIRONMENT=%j → %s', (value, expected) => {
      setEnv(value)
      expect(paddleEnvironmentFromProcessEnv()).toBe(expected)
    })
  })

  describe('buildContentSecurityPolicy (per-request nonce)', () => {
    it('injects the exact nonce it is given', () => {
      const csp = buildContentSecurityPolicy('AAAABBBBCCCCDDDD', 'production', false)
      expect(csp).toContain(`'nonce-AAAABBBBCCCCDDDD'`)
    })

    it('produces a different script-src for a different nonce', () => {
      expect(buildContentSecurityPolicy('AAAA', 'production', false)).not.toBe(
        buildContentSecurityPolicy('BBBB', 'production', false)
      )
    })

    it('accepts a real generated base64 nonce (with padding)', () => {
      expect(() =>
        buildContentSecurityPolicy('dGVzdC1ub25jZS0xMjM=', 'production', false)
      ).not.toThrow()
    })

    it('rejects a non-base64 nonce (CSP-injection guard)', () => {
      // A `'` would break out of the 'nonce-…' token and inject directives.
      expect(() => buildContentSecurityPolicy(`x' ; script-src *`, 'production', false)).toThrow(
        /base64/
      )
      expect(() => buildContentSecurityPolicy('', 'production', false)).toThrow(/base64/)
    })
  })

  describe('isConfirmedHttps (sec-1, HSTS scheme gate)', () => {
    it('is true only for a forwarded proto of https, case-insensitively', () => {
      expect(isConfirmedHttps('https')).toBe(true)
      expect(isConfirmedHttps('HTTPS')).toBe(true)
      expect(isConfirmedHttps('Https')).toBe(true)
    })

    it('takes the first hop of a comma-joined value', () => {
      expect(isConfirmedHttps('https, http')).toBe(true)
      expect(isConfirmedHttps('http, https')).toBe(false)
    })

    it('is false for http, absent, or empty', () => {
      expect(isConfirmedHttps('http')).toBe(false)
      expect(isConfirmedHttps(null)).toBe(false)
      expect(isConfirmedHttps(undefined)).toBe(false)
      expect(isConfirmedHttps('')).toBe(false)
    })
  })

  describe('isCanonicalHttpsRequest (story 5-6 F2, custom-domain HSTS gate)', () => {
    const SITE = 'https://www.longhandbudget.com'

    it('is true when the request host IS the canonical https origin host', () => {
      expect(isCanonicalHttpsRequest('www.longhandbudget.com', SITE)).toBe(true)
    })

    it('matches case-insensitively and ignores a default :443 port (Host header forms)', () => {
      expect(isCanonicalHttpsRequest('WWW.LonghandBudget.com', SITE)).toBe(true)
      expect(isCanonicalHttpsRequest('www.longhandbudget.com:443', SITE)).toBe(true)
    })

    it('is FALSE for any other host — a spoofed Host header cannot summon HSTS', () => {
      expect(isCanonicalHttpsRequest('evil.example', SITE)).toBe(false)
      expect(isCanonicalHttpsRequest('longhandbudget.com', SITE)).toBe(false)
      expect(isCanonicalHttpsRequest('www.longhandbudget.com.evil.example', SITE)).toBe(false)
      // A non-default port is a different origin, so it must not match.
      expect(isCanonicalHttpsRequest('www.longhandbudget.com:8080', SITE)).toBe(false)
    })

    it('is FALSE when the configured site origin is not https (dev/localhost)', () => {
      expect(isCanonicalHttpsRequest('localhost:5173', 'http://localhost:5173')).toBe(false)
    })

    it('is FALSE for a missing host or an unparseable site url, rather than throwing', () => {
      expect(isCanonicalHttpsRequest(null, SITE)).toBe(false)
      expect(isCanonicalHttpsRequest('', SITE)).toBe(false)
      expect(isCanonicalHttpsRequest('www.longhandbudget.com', 'not a url')).toBe(false)
      expect(isCanonicalHttpsRequest('www.longhandbudget.com', undefined)).toBe(false)
    })
  })

  describe('Strict-Transport-Security (sec-1 AC-3, gated on confirmed HTTPS)', () => {
    it('is present over confirmed HTTPS in production, without preload', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, {
        isDev: false,
        isHttps: true,
        nonce: TEST_NONCE,
        paddleEnvironment: 'production',
      })
      expect(headers.get('Strict-Transport-Security')).toBe(STRICT_TRANSPORT_SECURITY)
      expect(STRICT_TRANSPORT_SECURITY).toBe('max-age=31536000; includeSubDomains')
      // preload intentionally omitted (Lucas's decision — near-irreversible commitment).
      expect(headers.get('Strict-Transport-Security')).not.toContain('preload')
    })

    it('is ABSENT when the scheme is not confirmed HTTPS (plain HTTP)', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, {
        isDev: false,
        isHttps: false,
        nonce: TEST_NONCE,
        paddleEnvironment: 'production',
      })
      expect(headers.get('Strict-Transport-Security')).toBeNull()
    })

    it('is ABSENT in development even if the scheme reports HTTPS', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, {
        isDev: true,
        isHttps: true,
        nonce: TEST_NONCE,
        paddleEnvironment: 'production',
      })
      expect(headers.get('Strict-Transport-Security')).toBeNull()
    })
  })

  describe('Referrer-Policy and Permissions-Policy (sec-1 AC-4)', () => {
    it('sets a strict Referrer-Policy on every response', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, {
        isDev: false,
        isHttps: false,
        nonce: TEST_NONCE,
        paddleEnvironment: 'production',
      })
      expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
      expect(REFERRER_POLICY).toBe('strict-origin-when-cross-origin')
    })

    // Story sec-4 (AC-4, D3). Typed out in full: a change to any feature is a decision
    // made at this line. `self` is REQUIRED (Permissions Policy §9.7 step 2), and the
    // frame origin is what Paddle.js's checkout <iframe allow="payment"> loads.
    it('production: payment for self + the production Paddle checkout frame only; the rest denied (sec-4)', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, {
        isDev: false,
        isHttps: false,
        nonce: TEST_NONCE,
        paddleEnvironment: 'production',
      })
      expect(headers.get('Permissions-Policy')).toBe(
        'camera=(), microphone=(), geolocation=(), payment=(self "https://buy.paddle.com")'
      )
    })

    it('sandbox: also names the sandbox checkout frame (sec-4 D3)', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, { ...baseOpts, paddleEnvironment: 'sandbox' })
      expect(headers.get('Permissions-Policy')).toBe(
        'camera=(), microphone=(), geolocation=(), payment=(self "https://buy.paddle.com" "https://sandbox-buy.paddle.com")'
      )
    })

    it('a production policy never names the sandbox checkout origin (sec-4 D3)', () => {
      expect(buildPermissionsPolicy('production')).not.toContain('sandbox')
      expect(paddleCheckoutFrameOrigins('production')).toEqual(['https://buy.paddle.com'])
      expect(paddleCheckoutFrameOrigins('sandbox')).toEqual([
        'https://buy.paddle.com',
        'https://sandbox-buy.paddle.com',
      ])
    })

    it('is the same in development (the environment, not isDev, decides it)', () => {
      for (const env of ['production', 'sandbox'] as const) {
        const dev = new Headers()
        applySecurityHeaders(dev, { ...baseOpts, isDev: true, paddleEnvironment: env })
        expect(dev.get('Permissions-Policy')).toBe(buildPermissionsPolicy(env))
      }
    })
  })
})

describe('applyHeadersToNextResult (middleware path)', () => {
  it('applies the security headers to the response produced by next()', async () => {
    const result = await applyHeadersToNextResult(async () => ({ response: new Response('ok') }), {
      isDev: false,
      isHttps: true,
      nonce: TEST_NONCE,
      paddleEnvironment: 'production',
    })
    expect(result.response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(result.response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(result.response.headers.get('X-XSS-Protection')).toBe('1; mode=block')
    expect(result.response.headers.get('Content-Security-Policy')).toBe(
      buildContentSecurityPolicy(TEST_NONCE, 'production', false)
    )
    expect(result.response.headers.get('Strict-Transport-Security')).toBe(STRICT_TRANSPORT_SECURITY)
    expect(result.response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    // Body/result identity is preserved.
    expect(await result.response.text()).toBe('ok')
  })

  it('passes through extra result fields and honors dev CORS (and suppresses HSTS in dev)', async () => {
    const result = await applyHeadersToNextResult(
      async () => ({ response: new Response(null), pathname: '/x' }),
      { isDev: true, isHttps: true, nonce: TEST_NONCE, paddleEnvironment: 'production' }
    )
    expect(result.response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(result.response.headers.get('Strict-Transport-Security')).toBeNull()
    expect(result.pathname).toBe('/x')
  })
})
