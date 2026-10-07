/**
 * The sentence the expense delete dialog adds when debts name that expense as
 * their payment (Story 113.1, FR181, D6 copy).
 *
 * `names` are the linked debts' trimmed, non-blank names in balance-store order.
 * `unnamedCount` is the linked debts whose name was not a usable string: they
 * are left out of the list but still mean the expense is linked, so when EVERY
 * linked debt is unnamed the sentence still appears, without quotes.
 *
 * Returns `null` when nothing is linked: the dialog then reads exactly as it did
 * before this story.
 */
export function debtLinkSentence(names: readonly string[], unnamedCount: number): string | null {
  if (names.length === 0) {
    if (unnamedCount <= 0) return null
    return 'It pays one of your debts. Deleting it unlinks the debt, and your forecast will stop paying it down.'
  }
  const quoted = names.map((name) => `"${name}"`)
  if (quoted.length === 1) {
    return `It pays your debt ${quoted[0]}. Deleting it unlinks the debt, and your forecast will stop paying it down.`
  }
  const list = `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
  return `It pays your debts ${list}. Deleting it unlinks them, and your forecast will stop paying them down.`
}
