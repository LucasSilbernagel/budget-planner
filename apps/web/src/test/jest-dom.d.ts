/**
 * Makes the @testing-library/jest-dom matchers (toBeInTheDocument,
 * toHaveAttribute, toHaveValue, …) type-check on Vitest's `expect`. They are
 * registered at runtime in `vitest.setup.ts` (`expect.extend`); this file only
 * supplies their types and emits no runtime code.
 *
 * We augment the global `Chai.Assertion` — the base that `expect(x)`'s
 * `Assertion<T>` extends — deliberately. Do NOT "simplify" this to
 * `import '@testing-library/jest-dom/vitest'` or retarget it: with Vitest 1.6.x,
 * augmenting `vitest` no-ops (it re-exports `Assertion` from `@vitest/expect`
 * rather than declaring it), augmenting `vitest` in a script file shadows away
 * vitest's real exports, and augmenting `@vitest/expect` breaks the
 * `ExpectStatic`→`Assertion` chain ("ExpectStatic has no call signatures").
 * `Chai.Assertion` is the only target that attaches the matchers cleanly.
 *
 * Loaded for the test TS program via `tsconfig.vitest.json` (which globs
 * `src/test/**`) and, defensively, a `/// <reference>` from `src/test/utils.ts`.
 */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare global {
  namespace Chai {
    interface Assertion extends TestingLibraryMatchers<unknown, void> {}
  }
}
