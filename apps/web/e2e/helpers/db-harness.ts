import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DB_SERVER_PORT = 5176

/** Fixed, so `pnpm gates` can refuse a stray one before it starts. */
export const E2E_DB_PORT = 55432

/** PGlite accepts any credentials. */
export const E2E_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`

export const SEEDED_USER = {
  email: 'f9-sign-in@example.test',
  paddleId: 'ctm_e2e_f9_sign_in',
} as const

/**
 * The mailer's no-key dev branch appends `{ to, link }` here as JSON lines. Truncated
 * at database start, so it holds only this run's links.
 */
export const MAIL_OUTBOX = join(tmpdir(), 'budget-planner-e2e', 'mail-outbox.jsonl')

/**
 * Obvious fakes, so no real Paddle credential is in the repo or CI. `sandbox` exempts
 * the dev server from `assertPaddleProductionConfig()`.
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

/** Port 9 on loopback, where nothing listens, so every outbound request is refused locally. */
export const NO_OUTBOUND_PROXY = 'http://127.0.0.1:9'

export interface OutboxEntry {
  to: string
  link: string
}

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
