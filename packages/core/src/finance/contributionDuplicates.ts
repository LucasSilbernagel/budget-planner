// Presentation input only: NEVER changes a number. Byte-identical rows can be the same or
// different money, so the pool must not depend on this heuristic.

import type { NormalizableFinancialItem } from './netIncome'
import { normalizeToMonthly } from './normalization'

export interface DuplicateCandidateExpense extends NormalizableFinancialItem {
  id: string
  name: string
}

export interface DuplicateCandidateContribution extends NormalizableFinancialItem {
  id: string
  name: string
  recordedAsExpense?: boolean
}

export interface ContributionDuplicateInput {
  expenses: DuplicateCandidateExpense[]
  investmentContributions: DuplicateCandidateContribution[]
}

export interface ContributionDuplicateCandidate {
  expenseId: string
  expenseName: string
  contributionId: string
  contributionName: string
  monthlyCents: number
  nameSimilarity: number
  highlight: boolean
}

// Amount equality alone is not enough: round numbers collide constantly.
export const NAME_SIMILARITY_HIGHLIGHT_THRESHOLD = 0.34

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

// Unicode-aware and diacritic-folded: an ASCII-only split turned accented letters into separators.
function tokenize(name: string): Set<string> {
  const tokens = (name || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
  return new Set(tokens)
}

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

// Compared after monthly normalization; zero-amount rows are ignored (they'd match every zero).
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
