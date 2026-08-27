/**
 * Duplicate-contribution detector tests (Story 45.1, FR72)
 *
 * ⚠️ The load-bearing test in this file is the STRUCTURAL FENCE at the bottom:
 * `savingsAllocation.ts` must not import this module. Everything else here is
 * about a highlight; that one is about whether a heuristic can reach the money.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NAME_SIMILARITY_HIGHLIGHT_THRESHOLD,
  findContributionDuplicateCandidates,
  nameSimilarity,
} from '../contributionDuplicates.js'
import { calculateDistributablePool } from '../savingsAllocation.js'

const expense = (id: string, name: string, amount: number, frequency = 'monthly' as const) => ({
  id,
  name,
  amount,
  frequency,
})
const contribution = (
  id: string,
  name: string,
  amount: number,
  frequency = 'monthly' as const,
  recordedAsExpense?: boolean
) => ({ id, name, amount, frequency, recordedAsExpense })

describe('nameSimilarity', () => {
  it('scores an exact name 1', () => {
    expect(nameSimilarity('TFSA', 'TFSA')).toBe(1)
  })

  it('ignores case, punctuation and filler words', () => {
    // "contribution" is a stop word, so both sides reduce to {tfsa}.
    expect(nameSimilarity('TFSA contribution', 'tfsa')).toBe(1)
    expect(nameSimilarity('TFSA Contribution', 'TFSA - contribution')).toBe(1)
  })

  it('scores unrelated names 0', () => {
    expect(nameSimilarity('Rent', 'TFSA')).toBe(0)
  })

  it('scores a partial overlap between 0 and 1', () => {
    // {tfsa, growth} vs {tfsa, savings} → 1 shared / 3 union
    const score = nameSimilarity('TFSA growth', 'TFSA savings')
    expect(score).toBeCloseTo(1 / 3, 10)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('scores 0 when a name reduces to no tokens at all', () => {
    // Both sides are pure stop words — no signal, and no division by zero.
    expect(nameSimilarity('monthly contribution', 'the payment')).toBe(0)
  })
})

describe('findContributionDuplicateCandidates', () => {
  it('finds and highlights the FR72 reproduction', () => {
    const candidates = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'TFSA contribution', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA', 50_000)],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      expenseId: 'e1',
      contributionId: 'c1',
      monthlyCents: 50_000,
      highlight: true,
    })
  })

  it('matches across cadences, comparing NORMALIZED monthly amounts', () => {
    // 11538c/wk × 52/12 = 49998.0 → 49998. A monthly expense of 49998c is the
    // same money at a different cadence and must be found.
    const candidates = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'TFSA', 49_998)],
      investmentContributions: [contribution('c1', 'TFSA', 11_538, 'weekly')],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.monthlyCents).toBe(49_998)
  })

  it('does NOT match when the normalized amounts differ', () => {
    expect(
      findContributionDuplicateCandidates({
        expenses: [expense('e1', 'TFSA contribution', 50_000)],
        investmentContributions: [contribution('c1', 'TFSA', 40_000)],
      })
    ).toEqual([])
  })

  it('finds a coincidental amount match but does NOT highlight it', () => {
    // ⚠️ THE NOISE CASE, and the reason amount equality alone earns nothing.
    // A $500 rent line and a $500 TFSA contribution are unrelated money.
    const candidates = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'Rent', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA', 50_000)],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.nameSimilarity).toBe(0)
    expect(candidates[0]?.highlight).toBe(false)
  })

  it('never offers a row the user has already resolved', () => {
    expect(
      findContributionDuplicateCandidates({
        expenses: [expense('e1', 'TFSA contribution', 50_000)],
        investmentContributions: [contribution('c1', 'TFSA', 50_000, 'monthly', true)],
      })
    ).toEqual([])
  })

  it('ignores zero-amount rows so empty contributions do not match empty expenses', () => {
    expect(
      findContributionDuplicateCandidates({
        expenses: [expense('e1', 'Placeholder', 0)],
        investmentContributions: [contribution('c1', 'Placeholder', 0)],
      })
    ).toEqual([])
  })

  it('orders candidates by similarity descending, deterministically', () => {
    const candidates = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'Rent', 50_000), expense('e2', 'TFSA contribution', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA', 50_000)],
    })
    expect(candidates.map((c) => c.expenseId)).toEqual(['e2', 'e1'])
    // Stable across a reversed input order.
    const reversed = findContributionDuplicateCandidates({
      expenses: [expense('e2', 'TFSA contribution', 50_000), expense('e1', 'Rent', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA', 50_000)],
    })
    expect(reversed.map((c) => c.expenseId)).toEqual(['e2', 'e1'])
  })

  it('tolerates absent/empty inputs', () => {
    expect(
      findContributionDuplicateCandidates({ expenses: [], investmentContributions: [] })
    ).toEqual([])
    expect(
      findContributionDuplicateCandidates(
        undefined as unknown as Parameters<typeof findContributionDuplicateCandidates>[0]
      )
    ).toEqual([])
  })

  it('handles non-ASCII names as words, not as separators', () => {
    // ⚠️ Regression guard for an ASCII-only `/[^a-z0-9]+/` split, under which
    // "Épargne mensuelle" tokenized to {"pargne","mensuelle"} — the accent ATE
    // the letter. Two unrelated accented names then drifted toward each other.
    expect(nameSimilarity('Épargne', 'Épargne')).toBe(1)
    // Diacritics fold, so the same name typed with and without its accent matches.
    expect(nameSimilarity('Épargne', 'Epargne')).toBe(1)
    // ...and two genuinely unrelated accented names still score 0, which the
    // broken tokenizer could not guarantee (both lost their first letter).
    expect(nameSimilarity('Économies', 'École')).toBe(0)
    // Non-Latin scripts are tokenized, not annihilated.
    expect(nameSimilarity('貯蓄', '貯蓄')).toBe(1)
    expect(nameSimilarity('貯蓄', '家賃')).toBe(0)
  })

  it('finds and highlights a non-ASCII duplicate pair end to end', () => {
    const candidates = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'Épargne retraite', 50_000)],
      investmentContributions: [contribution('c1', 'Epargne retraite', 50_000)],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.highlight).toBe(true)
  })

  it('pins the highlight threshold boundary in BOTH directions', () => {
    // ⚠️ The calibration is deliberate and is asserted here rather than left to
    // the constant's value. One shared token out of three is weak evidence — the
    // amounts already matched, so the question is only whether the NAMES add
    // anything, and a single shared brand word across two different accounts
    // ("TFSA growth" vs "TFSA savings") does not. A highlight is a nudge, and an
    // over-eager nudge is the noise D6/D7 rejected a prompt over.
    const belowThreshold = nameSimilarity('TFSA growth', 'TFSA savings')
    expect(belowThreshold).toBeCloseTo(1 / 3, 10)
    expect(belowThreshold).toBeLessThan(NAME_SIMILARITY_HIGHLIGHT_THRESHOLD)

    // REJECTION arm: exactly this pair must not be highlighted.
    const notHighlighted = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'TFSA growth', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA savings', 50_000)],
    })
    expect(notHighlighted).toHaveLength(1)
    expect(notHighlighted[0]?.highlight).toBe(false)

    // ACCEPTANCE arm over the same shape, so the rejection cannot pass because
    // the fixture was malformed: drop one distinguishing word and it clears.
    const highlighted = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'TFSA growth', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA growth', 50_000)],
    })
    expect(highlighted[0]?.nameSimilarity).toBeGreaterThanOrEqual(
      NAME_SIMILARITY_HIGHLIGHT_THRESHOLD
    )
    expect(highlighted[0]?.highlight).toBe(true)
  })

  it('exposes the highlight threshold as the single gate', () => {
    // Pins that `highlight` is exactly `nameSimilarity >= THRESHOLD` and nothing
    // else — so a reviewer can check the gate without reading the implementation.
    const candidates = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'TFSA growth', 50_000), expense('e2', 'Rent', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA savings', 50_000)],
    })
    for (const candidate of candidates) {
      expect(candidate.highlight).toBe(
        candidate.nameSimilarity >= NAME_SIMILARITY_HIGHLIGHT_THRESHOLD
      )
    }
  })
})

/**
 * AC-4 — detection never drives the math, enforced structurally.
 */
describe('the detector is fenced off from the pool calculation (AC-4)', () => {
  it('savingsAllocation.ts does not import contributionDuplicates', () => {
    // ⚠️ Read the SOURCE, not the module graph: importing `savingsAllocation`
    // here would make this assertion about our own import, not about its.
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '..', 'savingsAllocation.ts'), 'utf8')
    expect(source).not.toMatch(/contributionDuplicates/)
    // And prove the file we read is the real one, so a bad path cannot make
    // this pass vacuously — a rejection assertion needs an acceptance partner.
    expect(source).toContain('export function calculateDistributablePool')
  })

  it('a pool with candidate duplicates present is UNCHANGED until the user flags a row', () => {
    // The detector reports a highlighted pair here...
    const detected = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'TFSA contribution', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA', 50_000)],
    })
    expect(detected[0]?.highlight).toBe(true)

    // ...and the pool still deducts twice, because nothing has been flagged.
    // net = 300000 − 50000 = 250000; contribution 50000 → 200000.
    expect(
      calculateDistributablePool({
        incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
        expenses: [{ amount: 50_000, frequency: 'monthly' }],
        investmentContributions: [{ amount: 50_000, frequency: 'monthly' }],
        savingsAccounts: [{ id: 'a', allocationMode: 'automatic' }],
      })
    ).toBe(200_000)
  })

  it('a coincidental (unhighlighted) match also leaves the pool alone', () => {
    const detected = findContributionDuplicateCandidates({
      expenses: [expense('e1', 'Rent', 50_000)],
      investmentContributions: [contribution('c1', 'TFSA', 50_000)],
    })
    expect(detected[0]?.highlight).toBe(false)
    expect(
      calculateDistributablePool({
        incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
        expenses: [{ amount: 50_000, frequency: 'monthly' }],
        investmentContributions: [{ amount: 50_000, frequency: 'monthly' }],
        savingsAccounts: [{ id: 'a', allocationMode: 'automatic' }],
      })
    ).toBe(200_000)
  })
})
