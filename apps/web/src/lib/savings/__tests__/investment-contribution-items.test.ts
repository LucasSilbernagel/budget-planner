import { describe, expect, it } from 'vitest'
import { investmentContributionItems } from '../investment-contribution-items'

const row = (monthlyContribution: unknown) => ({
  id: 'inv-1',
  name: 'TFSA',
  monthlyContribution: monthlyContribution as number,
  frequency: 'weekly',
})

describe('investmentContributionItems: a non-finite stored contribution', () => {
  it('keeps a healthy amount and is not unreadable', () => {
    expect(investmentContributionItems([row(50_000)])).toEqual([
      {
        id: 'inv-1',
        name: 'TFSA',
        amount: 50_000,
        frequency: 'weekly',
        recordedAsExpense: false,
        unreadable: false,
      },
    ])
  })

  it('keeps a stored 0 as a READABLE 0', () => {
    expect(investmentContributionItems([row(0)])[0]).toMatchObject({
      amount: 0,
      unreadable: false,
    })
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['null (a JSON-flattened NaN)', null],
    ['a numeric string', '500'],
    ['undefined', undefined],
  ])('%s: counts as 0 and is flagged unreadable', (_label, value) => {
    const [item] = investmentContributionItems([row(value)])
    expect(item).toMatchObject({ amount: 0, unreadable: true, frequency: 'weekly' })
    expect(Object.is(item?.amount, 0)).toBe(true)
  })

  it('leaves the other fields of an unreadable row alone', () => {
    const [item] = investmentContributionItems([
      { ...row(Number.NaN), contributionRecordedAsExpense: true },
    ])
    expect(item).toMatchObject({ id: 'inv-1', name: 'TFSA', recordedAsExpense: true })
  })
})
