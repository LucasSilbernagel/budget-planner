// Matches whole tokens only: variant-prefixed values (hover:bg-gray-50) are not swept,
// so dark:hover: pairs need explicit assertions.
export const RETIRED_LIGHT_ONLY_TOKENS = [
	'bg-white',
	'bg-gray-50',
	'bg-gray-100',
	'text-gray-900',
	'text-gray-800',
	'text-gray-700',
	'text-gray-600',
	'text-gray-500',
	'text-gray-400',
	'text-blue-600',
	'text-blue-700',
	// green-600 on white is 3.30:1, under AA.
	'text-green-600',
	'border-gray-200',
	'border-gray-100',
	'border-gray-300',
] as const

// An array, so callers can assert it is non-empty before an absence sweep.
export function collectClassTokens(root: HTMLElement): string[] {
	return [root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList])
}
