/**
 * Version Utilities
 *
 * Single source of truth for the running application version.
 *
 * The concrete value is injected at build time by Vite/Vitest `define` from
 * apps/web/package.json (see vite.config.ts / vitest.config.ts) as the
 * `__APP_VERSION__` global. Because the version is read from package.json, the
 * footer "updates when a new version is deployed" with no code change — a
 * version bump in package.json is all that is required (story 4-8, AC-1 / FR13).
 */

/** A parsed semantic version (MAJOR.MINOR.PATCH with optional prerelease). */
export interface SemanticVersion {
  major: number
  minor: number
  patch: number
  /** The prerelease tag without the leading `-` (e.g. `beta.2`), if present. */
  prerelease: string | undefined
}

// Matches MAJOR.MINOR.PATCH with an optional `-prerelease` suffix, following the
// official SemVer grammar: core identifiers and numeric prerelease identifiers
// reject leading zeros; prerelease identifiers are dot-separated and are either
// numeric or alphanumeric.
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/

// A SemVer prerelease identifier is "numeric" when it is all digits; such
// identifiers compare numerically and rank below alphanumeric ones (§11).
function isNumericIdentifier(identifier: string): boolean {
  return /^\d+$/.test(identifier)
}

/**
 * Compares two prerelease strings per SemVer §11: identifier-by-identifier,
 * numeric identifiers numerically, numeric ranking below alphanumeric, and a
 * larger set of identifiers ranking higher when all preceding ones are equal.
 */
function comparePrerelease(a: string, b: string): -1 | 0 | 1 {
  const aIds = a.split('.')
  const bIds = b.split('.')
  const shared = Math.min(aIds.length, bIds.length)

  for (let i = 0; i < shared; i++) {
    // Within `shared` both are defined; `?? ''` satisfies noUncheckedIndexedAccess
    // without a non-null assertion (disallowed by lint).
    const aId = aIds[i] ?? ''
    const bId = bIds[i] ?? ''
    if (aId === bId) continue

    const aNum = isNumericIdentifier(aId)
    const bNum = isNumericIdentifier(bId)
    if (aNum && bNum) return Number(aId) < Number(bId) ? -1 : 1
    if (aNum) return -1 // numeric identifiers have lower precedence
    if (bNum) return 1
    return aId < bId ? -1 : 1 // both alphanumeric: ASCII order
  }

  // All shared identifiers equal: the longer set has higher precedence.
  if (aIds.length === bIds.length) return 0
  return aIds.length < bIds.length ? -1 : 1
}

// Used only if `__APP_VERSION__` was never injected (e.g. an unconfigured
// runner). The build/test configs always define it, so this is a defensive
// fallback rather than a real code path.
const FALLBACK_VERSION = '0.0.0'

// `typeof` guard is safe whether or not `define` replaced the identifier: when
// injected it becomes `typeof "<version>"`; when absent it evaluates to
// `'undefined'` instead of throwing a ReferenceError.
const RESOLVED_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
    ? __APP_VERSION__
    : FALLBACK_VERSION

/** The application version string (e.g. `"0.0.1"`). */
export const APP_VERSION: string = RESOLVED_VERSION

/** Returns the application version string. */
export function getVersion(): string {
  return APP_VERSION
}

/**
 * Parses a semver string into its components.
 *
 * @throws {Error} if `version` is not a valid MAJOR.MINOR.PATCH string.
 */
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

/** Returns true if `version` is a valid MAJOR.MINOR.PATCH string. */
export function isValidVersion(version: string): boolean {
  return SEMVER_PATTERN.test(version)
}

/**
 * Compares two semver strings.
 *
 * @returns `-1` if `a` precedes `b`, `1` if `a` follows `b`, `0` if equal.
 *   Following semver precedence, a prerelease (e.g. `1.0.0-beta`) ranks lower
 *   than its corresponding release (`1.0.0`).
 * @throws {Error} if either argument is not a valid version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const va = parseVersion(a)
  const vb = parseVersion(b)

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (va[key] !== vb[key]) {
      return va[key] < vb[key] ? -1 : 1
    }
  }

  // Equal core versions: a release outranks a prerelease.
  if (va.prerelease === vb.prerelease) return 0
  if (va.prerelease === undefined) return 1
  if (vb.prerelease === undefined) return -1
  return comparePrerelease(va.prerelease, vb.prerelease)
}
