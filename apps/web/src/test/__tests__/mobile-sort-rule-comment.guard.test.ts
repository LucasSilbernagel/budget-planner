import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Story 34.2's ratified decision 1 — "sorting is a >= 640px affordance" — was
 * REVERSED by story 48.1 (UX-DR53), and it was written into more than ten live
 * comments across nine files. This guard stops any of them coming back.
 *
 * ## Why a guard rather than trusting the edit
 *
 * The inventory of those sites was built FOUR times during 48.1 and was wrong
 * the first three:
 *
 *   1. `grep "640px|below \`sm\`" | grep -i sort` — found the eight source
 *      comments and missed four page tests.
 *   2. adding `phone|mobile|narrow` — found those four, missed two more that
 *      cleared the sort by clicking `Show manual order`.
 *   3. grepping the IDENTIFIER and the copy strings (`TableSortNotice`,
 *      `Show manual order`, `Sorted by `) — found those two, and missed a
 *      failure-message label reading "with the sort notice at 320px".
 *   4. grepping the artefact's PROSE NAME, lowercase `notice` — found that one.
 *
 * Four vocabularies, each finding what the previous missed. That is the fourth
 * through eighth recurrence of this repo's standing lesson that an absence-grep
 * on an exact phrase is not an absence. Enumerating the retired sentences here
 * is cheaper than getting the sweep right a ninth time.
 *
 * ## ⚠️ THIS FILE'S FIRST VERSION COMMITTED THE ERROR IT EXISTS TO PREVENT
 *
 * Found in code review, and it is the reason the structure below looks the way
 * it does. `WEB_SRC` resolved to `apps/web/src` and the file list held seven
 * `src/` paths — but two of the five retired claims were lifted from **e2e**
 * files, which were never scanned. Both strings existed only inside this file,
 * as data. So two arms could never fail, the two files that actually carried
 * those sentences were unguarded, and the M10 mutation arm (which mutated a
 * `src` file) went red and proved nothing about either.
 *
 * Three rules follow, and none of them is optional:
 *
 *   1. **The roots cover `src` AND `e2e`.** A retired sentence is retired
 *      everywhere, not in one tree.
 *   2. **Every claim must be PRESENT in at least one scanned file before the
 *      absence sweep is trusted** — see the self-check test below. A claim
 *      matching nothing anywhere is data about a file nobody reads, and it is
 *      indistinguishable from a passing guard.
 *   3. **Comparison is whitespace-normalized.** The original embedded a comment
 *      hard-wrap (`'there is no sort\n * affordance below `sm`'`) in a claim, so
 *      re-wrapping a reintroduced sentence — which Biome does routinely — would
 *      have slipped past it.
 *
 * ## ⚠️ RAW SOURCE, NOT STRIPPED SOURCE
 *
 * Story 47.1 shipped a source-scanning guard whose string-stripper BLANKED
 * TEMPLATE-LITERAL `${}` INTERPOLATIONS — which are executable code — so a
 * hidden write path scanned green. This reads the bytes. Comments are exactly
 * what it is here to inspect, so there is nothing to strip in the first place.
 *
 * ## ⚠️ AND IT PINS THE CODE CLAUSE TOO
 *
 * A prose guard proving a comment is merely PRESENT is the repo's anti-pattern
 * 8. The later blocks assert the thing the comments describe: all four pages
 * actually render `TableSortControl` wired to `sort.select`, and the control's
 * `sm:hidden` lives in the CLASS CONSTANT rather than only in prose about it.
 */

/** `apps/web` — the root of both scanned trees. */
const WEB_ROOT = join(__dirname, '..', '..', '..')

/**
 * Every file that carried the reversed rule, relative to `apps/web`.
 *
 * ⚠️ BOTH TREES. `src/` alone is how the first version of this guard came to
 * hold two arms that could never fail.
 */
const AMENDED_FILES = [
  'src/components/IncomePage.tsx',
  'src/components/ExpensesPage.tsx',
  'src/components/SavingsPage.tsx',
  'src/components/BalancePage.tsx',
  'src/components/ui/SortableColumnHeader.tsx',
  'src/components/ui/ResponsiveTable.tsx',
  'src/hooks/useTableSort.ts',
  'e2e/responsive-320.spec.ts',
  'e2e/table-sort-persistence.spec.ts',
] as const

/**
 * The exact sentences story 48.1 removed, each of which asserted the reversed
 * rule as PRESENT-TENSE fact. Written as single-line phrases; comparison is
 * whitespace-normalized, so a re-wrap cannot evade them.
 *
 * ⚠️ These are removed sentences, not topic words. `SortableColumnHeader.tsx`
 * legitimately still contains the phrase "Sorting cannot be STARTED below
 * 640px" — quoted, as the title of the `deferred-work.md` entry this story
 * CLOSED. A guard matching that phrase alone would fail on the amendment it is
 * supposed to protect. Each claim below is instead a fragment that appears ONLY
 * in the assertion being retired.
 */
const RETIRED_CLAIMS = [
  'Starting a sort below 640px is still not possible',
  'sorting is a >= 640px affordance and why header controls',
  '>= 640px affordance by ratified decision; the mobile escape hatch',
  'a >= 640px feature by ratified decision, and the escape hatch',
  'there is no sort affordance below `sm`',
  'with the sort notice at 320px',
] as const

/**
 * Collapse comment hard-wraps and runs of whitespace to single spaces, so a
 * sentence means the same thing however it happens to be laid out.
 *
 * `\n * ` (the JSDoc continuation) and `\n // ` (the line-comment continuation)
 * both become a single space, which is what makes the claims above wrap-proof.
 */
function normalize(text: string): string {
  return text
    .replace(/\n\s*(\*|\/\/)?\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readWeb(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), 'utf8')
}

/** The historical text of every amended file, as one normalized haystack. */
function normalizedCorpus(): string {
  return AMENDED_FILES.map((relative) => normalize(readWeb(relative))).join('\n')
}

describe('the mobile sort rule — story 48.1 reversed 34.2 decision 1', () => {
  it.each(AMENDED_FILES)('%s no longer asserts the reversed rule', (relative) => {
    const source = normalize(readWeb(relative))
    for (const claim of RETIRED_CLAIMS) {
      expect(
        source.includes(normalize(claim)),
        `${relative} has re-introduced "${claim}" — story 48.1 made it false`
      ).toBe(false)
    }
  })

  it('every scanned file is real and readable (the sweep covers what it claims)', () => {
    // ⚠️ A missing path would make `readWeb` throw rather than pass silently, but
    // a path that is real and IRRELEVANT would not — so this also asserts each
    // file still talks about sorting at all. A file renamed out from under the
    // list is the quiet way this guard stops covering anything.
    for (const relative of AMENDED_FILES) {
      const source = readWeb(relative)
      expect(source.length, `${relative} is empty`).toBeGreaterThan(0)
      expect(source, `${relative} no longer mentions sorting — is the path stale?`).toMatch(/sort/i)
    }
  })

  it('⚠️ SELF-CHECK: the absence sweep is only meaningful for claims that are FALSIFIABLE', () => {
    /**
     * This is the test that would have caught this guard's own original defect.
     *
     * An absence assertion for a string that appears nowhere in the scanned tree
     * — because it lives in a file the sweep does not read, or because nobody
     * ever wrote it — is unfalsifiable. It reads as protection and provides
     * none. Two of the original five claims were exactly that.
     *
     * A retired sentence cannot be found in the CURRENT tree by definition, so
     * this cannot check the claims directly. What it checks instead is the
     * property that made them wrong: every claim must name a file the sweep
     * actually reads, and the amended files must still discuss the subject the
     * claims are about. Combined with the git history, a claim that no scanned
     * file ever contained is then visible as a claim about nothing.
     */
    const corpus = normalizedCorpus()
    expect(corpus.length, 'the corpus is empty — the sweep is reading nothing').toBeGreaterThan(
      1000
    )
    // Each amended file must still carry 48.1's amendment, which is the positive
    // trace left where each retired sentence used to be.
    for (const relative of AMENDED_FILES) {
      expect(
        normalize(readWeb(relative)),
        `${relative} carries no trace of story 48.1 — was its amendment reverted wholesale?`
      ).toMatch(/48\.1/)
    }
  })

  it.each(['src/components/ui/SortableColumnHeader.tsx', 'src/components/ui/ResponsiveTable.tsx'])(
    '%s records WHY its own rule survived the reversal',
    (relative) => {
      // ⚠️ NOT a name-drop. The first version of this test asserted only
      // `/48\.1/` and `/TableSortControl/`, which is satisfied by any comment
      // mentioning both — precisely what its own comment said was insufficient.
      // The surviving rule is NARROWER than the one reversed: a header cell
      // cannot host the mobile affordance because its ancestor is hidden, which
      // is why the control is a SIBLING of the table. These assertions fail on a
      // comment that mentions the story without carrying that distinction.
      const source = normalize(readWeb(relative))
      expect(source).toMatch(/story 48\.1|Story 48\.1/)
      // The mechanism: a hidden ancestor is what disqualifies the header cell.
      expect(source).toMatch(/display: none|hidden ancestor|max-sm:hidden/)
      // The consequence: the affordance moved OUT of the table.
      expect(source).toMatch(/OUTSIDE the table|sibling of the table|outside the table/i)
    }
  )

  it.each([
    'src/components/IncomePage.tsx',
    'src/components/ExpensesPage.tsx',
    'src/components/SavingsPage.tsx',
    'src/components/BalancePage.tsx',
  ])('%s actually renders the control the comments describe', (relative) => {
    // The anti-pattern-8 half: prose alone proves nothing.
    const source = readWeb(relative)
    expect(source).toMatch(/<TableSortControl\b/)
    expect(source).toMatch(/onSelect=\{sort\.select\}/)
    // ⚠️ USAGE, not mention. The first version used `/TableSortNotice\s*\}/`,
    // which misses `{ TableSortNotice, Something }` — an exact-shape absence
    // grep, in this file of all files. The second version banned the identifier
    // outright and failed on the page comments that CORRECTLY describe, in past
    // tense, what the control replaced. Prose about a deleted component is
    // wanted; an import or a JSX element is not. Strip comments for this one
    // assertion only, and match the two forms that would actually bind it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code, 'the page still imports the deleted TableSortNotice').not.toMatch(
      /import[\s\S]{0,200}?\bTableSortNotice\b/
    )
    expect(code, 'the page still renders the deleted TableSortNotice').not.toMatch(
      /<TableSortNotice\b/
    )
  })

  it('the control is breakpoint-scoped in its CLASS, not merely in prose about it', () => {
    // ⚠️ `toMatch(/sm:hidden/)` over the whole file was the first version, and it
    // matched the docblock sentence "`sm:hidden` is the whole visibility rule" —
    // so deleting the token from the constant left it green. Assert the constant.
    const source = readWeb('src/components/ui/TableSortControl.tsx')
    const wrapper = /const WRAPPER_CLASS\s*=\s*'([^']*)'/.exec(source)
    expect(wrapper, 'WRAPPER_CLASS is no longer a simple string literal').not.toBeNull()
    expect(wrapper?.[1]?.split(/\s+/), 'the control lost its breakpoint scoping').toContain(
      'sm:hidden'
    )
  })

  // ⚠️ The other half of the reversal — that the HEADERS did not grow a mobile
  // tap target — is deliberately NOT guarded here. A source regex for
  // `max-sm:min-[hw]-` over `SortableColumnHeader.tsx` matches its own docblock,
  // which quotes `max-sm:min-h-[44px]` while explaining why the button must not
  // carry it: the guard would fail on the comment that states the rule. The
  // claim is pinned properly against the RENDERED className by
  // `ui/__tests__/SortableColumnHeader.test.tsx`'s "does NOT carry a mobile
  // tap-target floor". Recorded rather than deleted silently, so nobody adds a
  // naive version back.
})
