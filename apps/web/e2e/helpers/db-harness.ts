/**
 * The `chromium-db` project's fixed facts (story 87.1, F9; story 87.2, F10),
 * in ONE place: `playwright.config.ts` boots the database and the `:5176` dev
 * server from them, and the `*.db.spec.ts` flows read the outbox, sign in and
 * sign webhooks with them.
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The `chromium-db` dev server (decision D4). */
export const DB_SERVER_PORT = 5176

/**
 * The PGlite socket (decision D1). Fixed, so `pnpm gates` can refuse a stray
 * one before it starts (`gates-lib.mjs`), like the Playwright server ports.
 */
export const E2E_DB_PORT = 55432

/** What the `:5176` dev server connects to. PGlite accepts any credentials. */
export const E2E_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`

/** The account F9 signs in as, seeded `active` (decision D3). */
export const SEEDED_USER = {
  email: 'f9-sign-in@example.test',
  paddleId: 'ctm_e2e_f9_sign_in',
} as const

/**
 * The dev-only mail outbox (decision D2): the mailer's no-key development
 * branch appends `{ to, link }` here as one JSON line. Truncated by the
 * database server at start, so it holds only this run's links.
 */
export const MAIL_OUTBOX = join(tmpdir(), 'budget-planner-e2e', 'mail-outbox.jsonl')

/**
 * The `:5176` server's Paddle configuration (story 87.2, decision D3): every
 * value an OBVIOUS FAKE, so no real Paddle credential exists in the repo or
 * CI. `sandbox`, so `assertPaddleProductionConfig()` exempts the dev server
 * and `/api/paddle/checkout-config` serves it. The webhook secret is what the
 * F10 spec signs its `subscription.created` with.
 */
export const FAKE_PADDLE = {
  environment: 'sandbox',
  apiKey: 'e2e-fake-paddle-api-key-not-real',
  clientToken: 'test_e2e_fake_client_token_not_real',
  webhookSecret: 'e2e-fake-webhook-secret-not-real',
  monthlyPriceId: 'pri_e2e_fake_monthly',
  annualPriceId: 'pri_e2e_fake_annual',
  lifetimePriceId: 'pri_e2e_fake_lifetime',
} as const

/**
 * The `:5176` server's HTTP(S) proxy: port 9 (discard) on loopback, where
 * nothing listens, so every outbound request is refused locally (story 87.2,
 * AC 4: no request leaves for `*.paddle.com`). Not a port anything opens.
 */
export const NO_OUTBOUND_PROXY = 'http://127.0.0.1:9'

export interface OutboxEntry {
  to: string
  link: string
}

/** Every outbox line, oldest first. A missing file reads as empty. */
export function readOutbox(path: string = MAIL_OUTBOX): OutboxEntry[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as OutboxEntry)
}
