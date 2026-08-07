/**
 * Documentation content registry (story 4-10).
 *
 * Each page's body is authored as a real static Markdown file and imported here
 * as a raw string via Vite's `?raw` suffix (AC-2: "content is fetched from
 * static markdown files"). The array order is the canonical ordering used by
 * both the documentation index and the sidebar navigation.
 *
 * Titles live here (not in Markdown front matter) so they are strongly typed
 * and so each `.md` body can start at an `<h2>` — the single `<h1>` per page is
 * the route header, which keeps the heading outline accessible.
 */

import faq from './faq.md?raw'
import features from './features.md?raw'
import gettingStarted from './getting-started.md?raw'

export interface DocPage {
  /** URL slug, used as the `$docId` route param (e.g. `getting-started`). */
  readonly slug: string
  /** Human-readable title shown in the header, index, and sidebar. */
  readonly title: string
  /** One-line summary shown on the documentation index. */
  readonly description: string
  /** Raw Markdown body, loaded from the corresponding static `.md` file. */
  readonly content: string
}

export const DOC_PAGES: readonly DocPage[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    description: 'Set up your income, expenses, and first overview.',
    content: gettingStarted,
  },
  {
    slug: 'features',
    title: 'Features',
    description: 'Everything Longhand can do, free and premium.',
    content: features,
  },
  {
    slug: 'faq',
    title: 'FAQ',
    description: 'Answers to common questions about data, privacy, and totals.',
    content: faq,
  },
]

/** Look up a documentation page by its slug, or `undefined` if none matches. */
export function getDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug)
}
