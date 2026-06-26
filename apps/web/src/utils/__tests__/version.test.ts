import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { APP_VERSION, compareVersions, getVersion, isValidVersion, parseVersion } from '../version'

/**
 * Version utility tests (story 4-8, AC-1).
 *
 * Asserts the version exposed to the UI is the real one from package.json
 * (so it "updates when a new version is deployed"), and that the semver
 * parse/compare/validate helpers behave correctly.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version: pkgVersion } = JSON.parse(
  readFileSync(resolve(__dirname, '../../../package.json'), 'utf-8')
) as { version: string }

describe('version utility', () => {
  describe('APP_VERSION / getVersion', () => {
    it('exposes the version inlined from package.json (single source of truth)', () => {
      expect(APP_VERSION).toBe(pkgVersion)
      expect(getVersion()).toBe(pkgVersion)
    })

    it('is a valid, non-empty semver string', () => {
      expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
      expect(isValidVersion(APP_VERSION)).toBe(true)
    })
  })

  describe('parseVersion', () => {
    it('parses a plain semver string', () => {
      expect(parseVersion('1.2.3')).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: undefined,
      })
    })

    it('parses a prerelease version', () => {
      expect(parseVersion('0.1.0-beta.2')).toEqual({
        major: 0,
        minor: 1,
        patch: 0,
        prerelease: 'beta.2',
      })
    })

    it('throws on a malformed version', () => {
      expect(() => parseVersion('not-a-version')).toThrow()
      expect(() => parseVersion('1.2')).toThrow()
      expect(() => parseVersion('')).toThrow()
    })
  })

  describe('isValidVersion', () => {
    it('accepts valid semver', () => {
      expect(isValidVersion('0.0.1')).toBe(true)
      expect(isValidVersion('10.20.30-rc.1')).toBe(true)
    })

    it('rejects invalid input', () => {
      expect(isValidVersion('1.2')).toBe(false)
      expect(isValidVersion('v1.2.3')).toBe(false)
      expect(isValidVersion('')).toBe(false)
    })

    it('rejects SemVer-forbidden leading zeros', () => {
      expect(isValidVersion('01.2.3')).toBe(false)
      expect(isValidVersion('1.02.3')).toBe(false)
      expect(isValidVersion('1.2.03')).toBe(false)
      expect(isValidVersion('1.0.0-01')).toBe(false)
      // A zero on its own is valid; an alphanumeric identifier may start with 0.
      expect(isValidVersion('0.0.0')).toBe(true)
      expect(isValidVersion('1.0.0-0a')).toBe(true)
    })
  })

  describe('compareVersions', () => {
    it('orders by major, then minor, then patch', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
      expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
      expect(compareVersions('1.0.5', '1.0.4')).toBe(1)
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    })

    it('treats a prerelease as lower precedence than its release', () => {
      expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
      expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1)
    })

    it('orders numeric prerelease identifiers numerically, not lexically (§11)', () => {
      // Lexically "alpha.2" > "alpha.10"; numerically alpha.2 < alpha.10.
      expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1)
      expect(compareVersions('1.0.0-alpha.10', '1.0.0-alpha.2')).toBe(1)
    })

    it('ranks numeric identifiers below alphanumeric ones', () => {
      expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
      expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1)
    })

    it('ranks a larger set of identifiers higher when the prefix is equal', () => {
      expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
      expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1)
    })

    it('matches the canonical SemVer §11 precedence chain', () => {
      const ordered = [
        '1.0.0-alpha',
        '1.0.0-alpha.1',
        '1.0.0-alpha.beta',
        '1.0.0-beta',
        '1.0.0-beta.2',
        '1.0.0-beta.11',
        '1.0.0-rc.1',
        '1.0.0',
      ]
      for (let i = 0; i < ordered.length - 1; i++) {
        expect(compareVersions(ordered[i], ordered[i + 1])).toBe(-1)
      }
    })
  })
})
