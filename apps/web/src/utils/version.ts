export interface SemanticVersion {
	major: number
	minor: number
	patch: number
	prerelease: string | undefined
}

// Official SemVer grammar: no leading zeros in core or numeric prerelease identifiers.
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/

function isNumericIdentifier(identifier: string): boolean {
	return /^\d+$/.test(identifier)
}

// SemVer §11 precedence.
function comparePrerelease(a: string, b: string): -1 | 0 | 1 {
	const aIds = a.split('.')
	const bIds = b.split('.')
	const shared = Math.min(aIds.length, bIds.length)

	for (let i = 0; i < shared; i++) {
		const aId = aIds[i] ?? ''
		const bId = bIds[i] ?? ''
		if (aId === bId) continue

		const aNum = isNumericIdentifier(aId)
		const bNum = isNumericIdentifier(bId)
		if (aNum && bNum) return Number(aId) < Number(bId) ? -1 : 1
		if (aNum) return -1
		if (bNum) return 1
		return aId < bId ? -1 : 1
	}

	if (aIds.length === bIds.length) return 0
	return aIds.length < bIds.length ? -1 : 1
}

const FALLBACK_VERSION = '0.0.0'

// `typeof` is safe whether or not `define` replaced the identifier (no ReferenceError).
const RESOLVED_VERSION =
	typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
		? __APP_VERSION__
		: FALLBACK_VERSION

export const APP_VERSION: string = RESOLVED_VERSION

export function getVersion(): string {
	return APP_VERSION
}

export function parseVersion(version: string): SemanticVersion {
	const match = SEMVER_PATTERN.exec(version)
	if (!match) {
		throw new Error(`Invalid semantic version: "${version}"`)
	}
	const [, major, minor, patch, prerelease] = match
	return {
		major: Number(major),
		minor: Number(minor),
		patch: Number(patch),
		prerelease,
	}
}

export function isValidVersion(version: string): boolean {
	return SEMVER_PATTERN.test(version)
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
	const va = parseVersion(a)
	const vb = parseVersion(b)

	for (const key of ['major', 'minor', 'patch'] as const) {
		if (va[key] !== vb[key]) {
			return va[key] < vb[key] ? -1 : 1
		}
	}

	if (va.prerelease === vb.prerelease) return 0
	if (va.prerelease === undefined) return 1
	if (vb.prerelease === undefined) return -1
	return comparePrerelease(va.prerelease, vb.prerelease)
}
