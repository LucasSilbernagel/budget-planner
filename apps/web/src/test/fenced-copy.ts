/**
 * Shared by the served-pages test (the server must NOT emit these) and the loading-state test
 * (the empty page DOES), so the fence stays falsifiable.
 */
export const FENCED_EMPTY_COPY = {
	'/': ['$0.00', "Let's set up your budget", '+ Add income'],
	'/income': ['$0.00', 'No income sources yet'],
	'/expenses': ['$0.00', 'No expenses recorded yet'],
	'/savings': ['$0.00', 'No savings goals recorded yet'],
	'/balance': ['$0.00', 'No balance entries recorded yet'],
} as const

export type GatedPath = keyof typeof FENCED_EMPTY_COPY
