/** Unnamed linked debts are left out of the list but still count as linked. */
export function debtLinkSentence(names: readonly string[], unnamedCount: number): string | null {
	if (names.length === 0) {
		if (unnamedCount <= 0) return null
		return 'It pays one of your debts. Deleting it unlinks the debt, and your forecast will stop paying it down.'
	}
	const quoted = names.map((name) => `"${name}"`)
	if (quoted.length === 1) {
		return `It pays your debt ${quoted[0]}. Deleting it unlinks the debt, and your forecast will stop paying it down.`
	}
	const list = `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
	return `It pays your debts ${list}. Deleting it unlinks them, and your forecast will stop paying them down.`
}
