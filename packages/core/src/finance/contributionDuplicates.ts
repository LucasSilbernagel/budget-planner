/**
 * Duplicate-contribution DETECTOR (Story 45.1, FR72)
 *
 * Finds expense lines that look like they describe the same money as an
 * investment row's contribution, so the Savings page can HIGHLIGHT that line
 * inside the leftover breakdown and the user can decide.
 *
 * ⚠️⚠️ THIS MODULE NEVER CHANGES A NUMBER. It is presentation input only.
 *
 * The distributable pool is computed in `./savingsAllocation.ts` from the
 * user-set `recordedAsExpense` flag and nothing else. That separation is the
 * whole point of the story, not an implementation detail:
 *
 *   A same-money user and a different-money user produce BYTE-IDENTICAL rows —
 *   same names, same amounts, same cadences. Any heuristic that decided the
 *   deduction from row content would necessarily be wrong for one of them,
 *   trading one wrong figure for a different wrong figure (FR72 / story D5).
 *
 * So the heuristic here earns a highlight and nothing more. `savingsAllocation.ts`
 * must never import this module; a test in `__tests__/contributionDuplicates.test.ts`
 * asserts the absence of that import structurally rather than by comment.
 *
 * Pure functions, no side effects. All amounts are integer cents.
 */

import type { NormalizableFinancialItem } from './netIncome'
import { normalizeToMonthly } from './normalization'

/** An expense line as the detector needs it. */
export interface DuplicateCandidateExpense extends NormalizableFinancialItem {
  id: string
  name: string
}

/** An investment contribution row as the detector needs it. */
export interface DuplicateCandidateContribution extends NormalizableFinancialItem {
  id: string
  name: string
  /** Already resolved by the user; such a row is never offered as a candidate. */
  recordedAsExpense?: boolean
}

export interface ContributionDuplicateInput {
  expenses: DuplicateCandidateExpense[]
  investmentContributions: DuplicateCandidateContribution[]
}

/**
 * One expense/contribution pair whose normalized monthly amounts are equal.
 * `highlight` is the only field the UI may use to give a row visual weight.
 */
export interface ContributionDuplicateCandidate {
  expenseId: string
  expenseName: string
  contributionId: string
  contributionName: string
  /** The shared normalized monthly amount, in cents. */
  monthlyCents: number
  /** 0..1 token-overlap score. Orders the list and gates `highlight`. */
  nameSimilarity: number
  /** True only when the amounts match AND the names are similar enough. */
  highlight: boolean
}

/**
 * Minimum `nameSimilarity` for a candidate to be highlighted.
 *
 * ⚠️ Amount equality ALONE is deliberately not enough. Round numbers collide
 * constantly — a $500 rent line and a $500 TFSA contribution match on amount and
 * are entirely unrelated. Highlighting on amount alone would put visual weight on
 * noise, which is the reason the story rejected a prompt/banner in the first
 * place (story D6/D7).
 */
export const NAME_SIMILARITY_HIGHLIGHT_THRESHOLD = 0.34

/** Words that carry no distinguishing signal when comparing a pair of names. */
const STOP_WORDS = new Set([
  'a',
  'account',
  'contribution',
  'contributions',
  'deposit',
  'fund',
  'monthly',
  'payment',
  'the',
  'to',
  'transfer',
])

/**
 * Lowercase letter/digit tokens, diacritics folded, stop-words removed.
 *
 * ⚠️ Unicode-aware on purpose. The first version split on `/[^a-z0-9]+/`, which
 * is ASCII-only, so every accented character acted as a SEPARATOR rather than
 * part of a token: `"Épargne mensuelle"` tokenized to `{"pargne","mensuelle"}`.
 * That produced false negatives AND false positives — two unrelated names both
 * beginning with an accented capital ("Économies", "École fees") each lost their
 * first letter and drifted toward each other. This app ships EUR/GBP/JPY/CNY/SEK,
 * so non-ASCII account names are the norm for much of its audience, not an edge.
 *
 * Diacritics are folded (NFKD + strip combining marks) so "Épargne" and
 * "Epargne" are the same token — a user who types the name twice, once with the
 * accent and once without, means the same account.
 */
function tokenize(name: string): Set<string> {
  const tokens = (name || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
  return new Set(tokens)
}

/**
 * Jaccard overlap of the two token sets: |A ∩ B| / |A ∪ B|, in 0..1.
 * Two names that reduce to no tokens at all score 0 rather than dividing by zero.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = tokenize(a)
  const right = tokenize(b)
  if (left.size === 0 || right.size === 0) {
    return 0
  }
  let shared = 0
  for (const token of left) {
    if (right.has(token)) {
      shared++
    }
  }
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

/**
 * Finds expense/contribution pairs whose normalized monthly amounts are equal.
 *
 * Equality is checked AFTER `normalizeToMonthly` so a $500/mo expense and a
 * $115.38/wk contribution are recognised as the same money at different cadences.
 *
 * Rows the user has already resolved (`recordedAsExpense === true`) are never
 * offered. Zero-amount rows are ignored — every empty contribution would
 * otherwise "match" every zero expense.
 *
 * Results are sorted by `nameSimilarity` descending, then by expense id and
 * contribution id, so the ordering is deterministic and stable across renders.
 *
 * @returns Candidate pairs. NEVER a number that any calculation consumes.
 */
export function findContributionDuplicateCandidates(
  input: ContributionDuplicateInput
): ContributionDuplicateCandidate[] {
  const expenses = input?.expenses || []
  const contributions = input?.investmentContributions || []

  const candidates: ContributionDuplicateCandidate[] = []

  for (const contribution of contributions) {
    if (contribution.recordedAsExpense === true) {
      continue
    }
    const contributionMonthly = normalizeToMonthly(contribution.amount, contribution.frequency)
    if (contributionMonthly <= 0) {
      continue
    }

    for (const expense of expenses) {
      const expenseMonthly = normalizeToMonthly(expense.amount, expense.frequency)
      if (expenseMonthly !== contributionMonthly) {
        continue
      }

      const similarity = nameSimilarity(expense.name, contribution.name)
      candidates.push({
        expenseId: expense.id,
        expenseName: expense.name,
        contributionId: contribution.id,
        contributionName: contribution.name,
        monthlyCents: contributionMonthly,
        nameSimilarity: similarity,
        highlight: similarity >= NAME_SIMILARITY_HIGHLIGHT_THRESHOLD,
      })
    }
  }

  return candidates.sort(
    (a, b) =>
      b.nameSimilarity - a.nameSimilarity ||
      a.expenseId.localeCompare(b.expenseId) ||
      a.contributionId.localeCompare(b.contributionId)
  )
}
