/**
 * The `chromium-db` project's fixed facts (story 87.1, F9), in ONE place:
 * `playwright.config.ts` boots the database and the `:5176` dev server from
 * them, and `sign-in.db.spec.ts` reads the outbox and signs in with them.
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
