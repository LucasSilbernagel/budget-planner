import { describe, expect, it } from 'vitest'
import { debtLinkSentence } from '../debt-link-sentence'

describe('debtLinkSentence (Story 113.1, FR181)', () => {
  it('is null when no debt links the expense', () => {
    expect(debtLinkSentence([], 0)).toBeNull()
  })

  it('names one debt, singular', () => {
    expect(debtLinkSentence(['Car loan'], 0)).toBe(
      'It pays your debt "Car loan". Deleting it unlinks the debt, and your forecast will stop paying it down.'
    )
  })

  it('joins two debts with "and", plural', () => {
    expect(debtLinkSentence(['A', 'B'], 0)).toBe(
      'It pays your debts "A" and "B". Deleting it unlinks them, and your forecast will stop paying them down.'
    )
  })

  it('joins three debts with commas and a final "and"', () => {
    expect(debtLinkSentence(['A', 'B', 'C'], 0)).toBe(
      'It pays your debts "A", "B" and "C". Deleting it unlinks them, and your forecast will stop paying them down.'
    )
  })

  it('says "one of your debts", unquoted, when every linked debt is unnamed', () => {
    expect(debtLinkSentence([], 1)).toBe(
      'It pays one of your debts. Deleting it unlinks the debt, and your forecast will stop paying it down.'
    )
  })

  it('leaves unnamed debts out of the list when a named one exists', () => {
    expect(debtLinkSentence(['Car loan'], 1)).toBe(debtLinkSentence(['Car loan'], 0))
  })
})
