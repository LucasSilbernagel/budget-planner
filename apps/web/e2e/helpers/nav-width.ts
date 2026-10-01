/**
 * Nav width constants for the specs that still need them.
 *
 * Until story 84.2 this file was the nav row's intrinsic-width harness (story
 * 59.1, re-scoped by 59.2). 84.2 (FR137) deleted every test that used the harness,
 * so the harness went with them; its claims are listed in
 * `_bmad-output/implementation-artifacts/84-2-evidence/inventory.md`. Recover it
 * from git history (`git show ac09038:apps/web/e2e/helpers/nav-width.ts`, the last commit with it) before
 * measuring the row again, rather than hand-rolling another version.
 */

export const NAV = 'nav[aria-label="Primary"]'

/**
 * Tailwind's `lg`: from here the row carries Balances and Retirement too (story
 * 69.3, FR110, decision D1). Below it the row is the five-item row of story
 * 59.2.
 */
export const LG = 1024

/** The Retirement-planner preference's persisted key (`plannerVisibilityStore`). */
export const PLANNER_STORAGE_KEY = 'budget-planner-planner-visibility-v1'
